/**
 * 同步引擎（plan-v2-accounts.md §7）。
 *
 * 协议：POST /api/snippets/sync 一个端点完成上行推送 + 下行拉取；
 * 删除走 DELETE /api/snippets/:id（软删墓碑由服务端传播）。
 *
 * 冲突规则（唯一不能妥协的一条）：客户端 updatedAt 早于服务端时不覆盖，
 * 本地版本另存为「（冲突副本）」条目重新入队——绝不静默丢弃用户写过的字。
 *
 * 触发时机（§7.2）：本地写入后防抖 2 秒、窗口 focus、每 5 分钟轮询、
 * navigator.onLine 恢复时立刻冲刷。失败按指数退避（1s/2s/4s…上限 5 分钟），
 * 连续失败进入 paused 状态，用户可点击状态栏手动重试。
 */
import { createHistoryId } from '../storage/history'
import { RestoreCapError, restoreBlockedByCap, type Snippet } from '../storage/snippets'
import type { LocalSnippetStore } from '../storage/SnippetStore'
import { cloudApi, CloudApiError } from './api'
import type { ApiSnippet, SyncResult } from './api'
import { isLangId } from '../detection/language'

/** 队列键按 user.id 隔离：换账号登录时 A 的待推内容绝不会被推进 B 的账号 */
export const QUEUE_KEY_PREFIX = 'vimpaste.syncqueue.v1'

export function queueKeyFor(userId: number): string {
  return `${QUEUE_KEY_PREFIX}.${userId}`
}

export const PUSH_DEBOUNCE_MS = 2000
const POLL_INTERVAL_MS = 5 * 60 * 1000
const MAX_BACKOFF_MS = 5 * 60 * 1000
/** 单次 sync 请求的 changes 上限（与服务端 schema 一致） */
const MAX_CHANGES_PER_REQUEST = 500

export interface SyncQueue {
  /** 待推送的条目（完整内容，按 id 去重保留最新） */
  upserts: Snippet[]
  /** 待删除的条目 id */
  deletes: string[]
  /** 服务端时间基线：下次增量拉取的 since */
  lastSyncAt: number | null
}

export type SyncState = 'idle' | 'syncing' | 'ok' | 'paused'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
}

export function loadQueue(key: string): SyncQueue {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { upserts: [], deletes: [], lastSyncAt: null }
    const parsed = JSON.parse(raw) as Partial<SyncQueue>
    return {
      upserts: Array.isArray(parsed.upserts) ? parsed.upserts : [],
      deletes: Array.isArray(parsed.deletes) ? parsed.deletes : [],
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : null,
    }
  } catch {
    return { upserts: [], deletes: [], lastSyncAt: null }
  }
}

export function saveQueue(key: string, queue: SyncQueue): void {
  try {
    localStorage.setItem(key, JSON.stringify(queue))
  } catch {
    /* 队列持久化失败不致命：最多多推一轮 */
  }
}

/** 服务端条目 → 本地缓存条目（时间戳已由服务端转为 epoch ms） */
export function serverToLocal(api: ApiSnippet): Snippet {
  return {
    id: api.id,
    title: api.title,
    content: api.content,
    ...(api.note ? { note: api.note } : {}),
    langId: isLangId(api.langId) ? api.langId : 'plaintext',
    kind: api.kind === 'prompt' ? 'prompt' : 'command',
    pinned: api.pinned,
    localOnly: false,
    collectionId: api.collectionId,
    tags: api.tags,
    deletedAt: api.deletedAt,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
    syncState: 'synced',
  }
}

/** 本地条目 → 服务端 payload（字段名与 server schema 一致） */
export function localToApi(s: Snippet): ApiSnippet {
  return {
    id: s.id,
    kind: s.kind === 'prompt' ? 'prompt' : 'command',
    title: s.title,
    content: s.content,
    note: s.note ?? null,
    langId: s.langId,
    pinned: s.pinned === true,
    usageCount: 0,
    lastUsedAt: null,
    collectionId: s.collectionId ?? null,
    tags: s.tags ?? [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt ?? null,
  }
}

export interface SyncEngineOptions {
  store: LocalSnippetStore
  onStatus: (status: SyncStatus) => void
  /** 本引擎的持久化队列键（按登录用户隔离，见 queueKeyFor） */
  queueKey: string
}

export class SyncEngine {
  private queue: SyncQueue
  private backoffMs = 1000
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private status: SyncStatus = { state: 'idle', lastSyncAt: null }
  private flushing = false
  private pendingFlush = false
  /** 引擎自身写入 store（拉取合并 / 冲突副本）时挂起 onUpsert 钩子，防止回环入队 */
  private applyingRemote = false
  /** 回收站恢复写回本地缓存期间同样挂起钩子（服务端已经是我们写入的样子） */
  private suppressHooks = false
  /** 正在途中的删除（已发出 DELETE、还没拿到响应） */
  private readonly inFlightDeletes = new Set<string>()
  /** 在途删除期间用户点了「恢复」：DELETE 落地后要立刻撤销（否则条目又被删一次） */
  private readonly undoAfterDelete = new Set<string>()
  /** 恢复串行化：两路并发 restore 不能都通过满额检查再各自写入，否则会截断挤掉一条 */
  private restoreChain: Promise<void> = Promise.resolve()

  constructor(private readonly opts: SyncEngineOptions) {
    this.queue = loadQueue(opts.queueKey)
  }

  /** 引擎写 store 期间为 true；store 的 onUpsert 钩子据此避免把拉取结果再入队 */
  get remoteWrite(): boolean {
    return this.applyingRemote || this.suppressHooks
  }

  currentStatus(): SyncStatus {
    return this.status
  }

  start(): void {
    if (this.pollTimer !== null) return
    window.addEventListener('focus', this.handleFocus)
    window.addEventListener('online', this.handleOnline)
    this.pollTimer = setInterval(() => void this.flush(), POLL_INTERVAL_MS)
  }

  stop(): void {
    window.removeEventListener('focus', this.handleFocus)
    window.removeEventListener('online', this.handleOnline)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.pollTimer = this.debounceTimer = this.retryTimer = null
  }

  private handleFocus = (): void => {
    void this.flush()
  }

  private handleOnline = (): void => {
    this.resetBackoff()
    void this.flush()
  }

  private setStatus(state: SyncState, lastSyncAt?: number | null): void {
    this.status = {
      state,
      lastSyncAt: lastSyncAt === undefined ? this.status.lastSyncAt : lastSyncAt,
    }
    this.opts.onStatus(this.status)
  }

  private resetBackoff(): void {
    this.backoffMs = 1000
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /** 本地写入 → 入队 + 防抖推送（§7.2） */
  enqueueUpsert(snippet: Snippet): void {
    if (snippet.localOnly) {
      // 仅本地：连同此前已在待推队列里的旧版本一起出队（防抖窗口内被切换的场景），
      // 否则旧 payload 会在下一轮被推上服务器，仅本地的承诺失效
      this.queue.upserts = this.queue.upserts.filter((s) => s.id !== snippet.id)
      saveQueue(this.opts.queueKey, this.queue)
      return
    }
    this.queue.upserts = [
      ...this.queue.upserts.filter((s) => s.id !== snippet.id),
      { ...snippet, syncState: 'pending' },
    ]
    saveQueue(this.opts.queueKey, this.queue)
    this.schedulePush()
  }

  /** 本地删除 → 入队软删除（防止拉取复活：pending delete 期间跳过该 id 的下行合并） */
  enqueueDelete(id: string): void {
    this.queue.upserts = this.queue.upserts.filter((s) => s.id !== id)
    if (!this.queue.deletes.includes(id)) this.queue.deletes.push(id)
    saveQueue(this.opts.queueKey, this.queue)
    this.schedulePush()
  }

  /** 首次登录合并：把本机既有条目整体标记为待推送（§3.1 合并向导） */
  enqueueMany(snippets: Snippet[]): void {
    for (const s of snippets) {
      // 墓碑与仅本地条目都不上传：合并只搬运「本机还活着的」内容，
      // 删除留在本地回收站，不为了合并去服务端造墓碑
      if (s.localOnly || s.deletedAt != null) continue
      this.queue.upserts = [
        ...this.queue.upserts.filter((e) => e.id !== s.id),
        { ...s, syncState: 'pending' },
      ]
    }
    saveQueue(this.opts.queueKey, this.queue)
    this.schedulePush()
  }

  private schedulePush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.flush(), PUSH_DEBOUNCE_MS)
  }

  /** 用户手动重试：清退避、立即冲刷 */
  retryNow(): void {
    this.resetBackoff()
    void this.flush()
  }

  /**
   * 冲刷队列并增量拉取。并发调用合并为一次（flushing 期间的新请求置 pendingFlush）。
   * 全量拉取（登录后）走 pullAll()。
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      this.pendingFlush = true
      return
    }
    this.flushing = true
    this.setStatus('syncing')
    try {
      const deletedNow = await this.pushDeletes()
      // 先增量拉取（空队列的轮询 / focus 触发也要拉），再推上行批次。
      // 本轮刚删除的 id 跳过合并：拉到的快照可能早于删除，避免行被复活
      const pullResult = await cloudApi.sync(this.queue.lastSyncAt ?? 0, [])
      if (this.queue.lastSyncAt === null || pullResult.now > this.queue.lastSyncAt) {
        this.queue.lastSyncAt = pullResult.now
      }
      saveQueue(this.opts.queueKey, this.queue)
      this.mergePulled(pullResult.pulled, new Set(), deletedNow)
      while (this.queue.upserts.length > 0) {
        const before = this.queue.upserts.length
        const batch = this.queue.upserts.slice(0, MAX_CHANGES_PER_REQUEST).map(localToApi)
        const result = await cloudApi.sync(this.queue.lastSyncAt ?? 0, batch)
        this.absorbSyncResult(result, batch)
        // 无进展保护：一批既没有 applied 也没有缩短队列（服务端持续冲突等病态情形）
        // 时退出，把控制权交还事件循环，避免 while 死循环
        if (this.queue.upserts.length >= before) break
      }
      this.resetBackoff()
      this.setStatus('ok', this.queue.lastSyncAt)
      // 队列仍有残留（如冲突副本）：排下一轮推送继续消化
      if (this.queue.upserts.length > 0) this.schedulePush()
    } catch {
      this.setStatus('paused')
      this.scheduleRetry()
    } finally {
      this.flushing = false
      if (this.pendingFlush) {
        this.pendingFlush = false
        this.schedulePush()
      }
    }
  }

  /** 登录后的全量拉取（since=0，不带上行）；返回是否有待合并的本机条目交给向导 */
  async pullAll(): Promise<void> {
    if (this.flushing) {
      this.pendingFlush = true
      return
    }
    this.flushing = true
    this.setStatus('syncing')
    try {
      const result = await cloudApi.sync(0, [])
      this.queue.lastSyncAt = result.now
      saveQueue(this.opts.queueKey, this.queue)
      this.mergePulled(result.pulled, new Set())
      this.resetBackoff()
      this.setStatus('ok', result.now)
    } catch {
      this.setStatus('paused')
      this.scheduleRetry()
    } finally {
      this.flushing = false
      if (this.pendingFlush) {
        this.pendingFlush = false
        this.schedulePush()
      }
    }
  }

  private async pushDeletes(): Promise<string[]> {
    const deleted: string[] = []
    while (this.queue.deletes.length > 0) {
      const id = this.queue.deletes[0]
      this.inFlightDeletes.add(id)
      try {
        await cloudApi.deleteSnippet(id)
      } catch (error) {
        // 404 = 服务端从未见过该条目（离线新建后、尚未推送就被删除）：视同已删除。
        // 若当作失败重试，这条 404 会永远堵在队列头，整个同步停摆。
        if (!(error instanceof CloudApiError && error.status === 404)) throw error
      } finally {
        this.inFlightDeletes.delete(id)
      }
      // 按 id 过滤而不是 slice(1)：请求在途期间用户可能点了「恢复」，队列已被改写，
      // 盲目切首位会把另一条待推删除误当作已完成
      this.queue.deletes = this.queue.deletes.filter((d) => d !== id)
      if (this.undoAfterDelete.delete(id)) {
        // 删除在途时用户点了「恢复」：这次 DELETE 已经落到服务端，立刻撤销。
        // 撤销失败不抛错——本地条目仍在回收站里，用户可以再点一次恢复
        try {
          await cloudApi.restoreSnippet(id)
        } catch {
          /* 本地仍是墓碑，用户可重试 */
        }
      } else {
        deleted.push(id)
      }
      saveQueue(this.opts.queueKey, this.queue)
    }
    return deleted
  }

  /**
   * 从回收站恢复（云端）：撤下待推删除 → 请服务端清墓碑 → 写回本地缓存。
   *
   * 失败一律抛给调用方（UI 弹错误）——静默吞掉会让用户以为恢复了，
   * 下一轮同步却把墓碑再拉回来，条目「恢复后又不见了」。
   */
  async restoreFromTrash(id: string): Promise<void> {
    const previous = this.restoreChain
    let release!: () => void
    this.restoreChain = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous
      await this.restoreFromTrashLocked(id)
    } finally {
      release()
    }
  }

  private assertRoomToRestore(): void {
    if (restoreBlockedByCap(this.opts.store.current(), this.opts.store.maxEntries)) {
      throw new RestoreCapError()
    }
  }

  private async restoreFromTrashLocked(id: string): Promise<void> {
    // 满额拒绝必须在撤队列 / 打 API 之前：否则服务端已经恢复、本机却挤掉另一条
    this.assertRoomToRestore()
    const local = this.opts.store.current().find((s) => s.id === id)
    // 1) 待推删除先撤下来：否则恢复成功后，队列里的 DELETE 会把墓碑再打回去
    this.queue.deletes = this.queue.deletes.filter((d) => d !== id)
    this.queue.upserts = this.queue.upserts.filter((s) => s.id !== id)
    saveQueue(this.opts.queueKey, this.queue)
    // 2) 删除可能正在途中（flush 已发出请求）：登记，让 pushDeletes 在响应回来后撤销
    if (this.inFlightDeletes.has(id)) this.undoAfterDelete.add(id)

    // 服务端墓碑是权威来源：本地缓存里没有这条也必须先请服务端清墓碑。
    // 刷新 / 换设备后下行合并已经把本地墓碑移除（mergePulled → store.remove），
    // 此时 local 为空，若跳过 API 直接 restoreLocally 会以「条目不存在」失败——
    // 而回收站列表来自 GET /trash，条目明明还在。
    if (!local || local.syncState !== 'local') {
      try {
        const row = await cloudApi.restoreSnippet(id)
        // API 等待期间用户可能又保存了一条，把最后一个名额占掉：写回前再查一次
        this.assertRoomToRestore()
        this.writeRemote(serverToLocal(row))
        return
      } catch (error) {
        // 404 = 服务端没有这条（墓碑已被 30 天任务清掉，或从未推送成功）：
        // 继续往下走，本地恢复并重新入队——点了恢复就该恢复，绝不丢字
        if (!(error instanceof CloudApiError && error.status === 404)) throw error
      }
    }
    this.assertRoomToRestore()
    this.restoreLocally(local)
  }

  /** 本地恢复并重新入队（服务端没有这条时走正常 onUpsert 钩子上行） */
  private restoreLocally(local: Snippet | undefined): void {
    if (!local) throw new CloudApiError(404, 'NOT_FOUND', '条目不存在')
    this.opts.store.upsert({
      ...local,
      deletedAt: null,
      updatedAt: Date.now(),
      syncState: local.localOnly ? 'local' : 'pending',
    })
  }

  /** 写本地缓存但不再入队（服务端已经是我们写入的样子） */
  private writeRemote(snippet: Snippet): void {
    this.suppressHooks = true
    try {
      this.opts.store.upsert(snippet)
    } finally {
      this.suppressHooks = false
    }
  }

  /**
   * 彻底删除（云端）：撤下队列里的软删除，再请服务端物理删除。
   * 服务端还把它当在用条目（删除还在防抖窗口里）时先软删再硬删；
   * 404 表示服务端根本没有这条（离线新建后删除），本地清掉即可。
   */
  async purgeFromTrash(id: string): Promise<void> {
    this.queue.deletes = this.queue.deletes.filter((d) => d !== id)
    this.queue.upserts = this.queue.upserts.filter((s) => s.id !== id)
    saveQueue(this.opts.queueKey, this.queue)
    try {
      await cloudApi.purgeSnippet(id)
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 404) return
      if (error instanceof CloudApiError && error.status === 409) {
        await cloudApi.deleteSnippet(id)
        await cloudApi.purgeSnippet(id)
        return
      }
      throw error
    }
  }

  /** 清空回收站（云端）：先把待推删除送达，服务端此时才把它们视为墓碑 */
  async emptyTrashRemote(): Promise<number> {
    await this.pushDeletes()
    return cloudApi.emptyTrash()
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delay)
  }

  private absorbSyncResult(result: SyncResult, batch: ApiSnippet[]): void {
    const pendingIds = new Set(batch.map((s) => s.id))
    // 服务端时间基线向前推进
    if (this.queue.lastSyncAt === null || result.now > this.queue.lastSyncAt) {
      this.queue.lastSyncAt = result.now
    }
    // 已应用的条目从队列移除，缓存标记 synced
    const applied = new Set(result.applied)
    const applyingRemote = this.applyingRemote
    this.applyingRemote = true
    try {
      for (const id of applied) {
        const pushed = batch.find((b) => b.id === id)
        if (!pushed) continue
        // 请求在途期间用户又编辑了该条目（队列里已是更新的版本）：
        // 保留新版本等下一轮推送，绝不拿这轮推送的旧内容覆盖它
        const queued = this.queue.upserts.find((s) => s.id === id)
        if (queued && queued.updatedAt > pushed.updatedAt) continue
        this.queue.upserts = this.queue.upserts.filter((s) => s.id !== id)
        const current = this.opts.store.current().find((s) => s.id === id)
        if (!current || current.updatedAt <= pushed.updatedAt) {
          this.opts.store.upsert(serverToLocal(pushed))
        }
      }
      // 冲突：本地另存副本重新入队，采用服务端版本
      for (const conflict of result.conflicts) {
        // 过期冲突（不在本批次里）忽略，防止与残留队列互相干扰
        if (!pendingIds.has(conflict.id)) continue
        const local = this.queue.upserts.find((s) => s.id === conflict.id)
        this.queue.upserts = this.queue.upserts.filter((s) => s.id !== conflict.id)
        if (conflict.server) {
          const current = this.opts.store.current().find((s) => s.id === conflict.id)
          if (!current || current.updatedAt <= conflict.server.updatedAt) {
            this.opts.store.upsert(serverToLocal(conflict.server))
          }
        }
        if (local) this.saveConflictCopy(local)
      }
      this.mergePulled(result.pulled, pendingIds)
    } finally {
      this.applyingRemote = applyingRemote
    }
    saveQueue(this.opts.queueKey, this.queue)
  }

  private mergePulled(
    pulled: ApiSnippet[],
    pendingIds: Set<string>,
    deletedNow: string[] = [],
  ): void {
    const applyingRemote = this.applyingRemote
    this.applyingRemote = true
    try {
      for (const p of pulled) {
        // 本地删除尚未送达服务端、或本轮刚送达（快照早于删除）：跳过，防止拉取复活
        if (this.queue.deletes.includes(p.id) || deletedNow.includes(p.id)) continue
        if (p.deletedAt !== null) {
          const local = this.opts.store.current().find((s) => s.id === p.id)
          if (local?.localOnly) continue // 仅本地条目：用户已选择留在本机，服务端墓碑不影响它
          if (local && local.updatedAt > p.updatedAt) {
            // 本地有比服务端删除更晚的修改：另存冲突副本，绝不丢字
            this.saveConflictCopy(local)
          }
          this.opts.store.remove(p.id)
          continue
        }
        if (pendingIds.has(p.id)) continue // 本批次正在推送的条目以本地为准
        const local = this.opts.store.current().find((s) => s.id === p.id)
        if (local && (local.syncState === 'pending' || local.syncState === 'local')) {
          // 本地有未推送版本：不覆盖（其内容在队列里，下一轮推送见分晓）
          continue
        }
        if (!local || p.updatedAt >= local.updatedAt) {
          this.opts.store.upsert(serverToLocal(p))
        }
      }
    } finally {
      this.applyingRemote = applyingRemote
    }
  }

  /** 冲突副本：新 id、标题加后缀、时间取当前（§7.1）。仅本地的版本保持仅本地、不入队 */
  private saveConflictCopy(local: Snippet): void {
    const copy: Snippet = {
      ...local,
      id: createHistoryId(),
      title: `${local.title}（冲突副本）`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncState: local.localOnly ? 'local' : 'pending',
    }
    this.opts.store.upsert(copy)
    if (!local.localOnly) {
      this.queue.upserts = [...this.queue.upserts, { ...copy }]
    }
  }
}
