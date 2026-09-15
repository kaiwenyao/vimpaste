/**
 * SnippetStore 抽象（plan-v2-accounts.md §4.3）：UI 不关心数据在哪。
 * - LocalSnippetStore：localStorage（匿名路径，也是登录后的本地缓存底层）；
 * - CloudSnippetStore：包一层同步队列——读走本地（瞬时响应），写先落本地再入队推送。
 *
 * 删除语义（回收站）：`trash()` 写墓碑、保留内容 30 天；`restore()` 清墓碑回到片段库；
 * `purge()` / `emptyTrash()` 才是不可恢复的硬删；`purgeExpired()` 清掉到期墓碑。
 * `remove()` 仍是「立即硬删」——它服务于回收站自身的清空路径与同步引擎的下行墓碑落地，
 * 不再是 UI 上「删除条目」的入口（那是 trash）。
 *
 * 与计划中接口的差异：list/upsert/remove 之外增加了 subscribe（React 状态同步用）
 * 与 replaceAll（登录全量拉取 / 登出回退用），均为实现同步引擎所需的最小扩展。
 */
import type { Snippet } from './snippets'
import {
  dropSnippets,
  isTrashExpired,
  isTrashed,
  loadSnippetsFrom,
  markRestored,
  markTrashed,
  RestoreCapError,
  restoreBlockedByCap,
  saveSnippetsTo,
  storedEntryCount,
  trashedSnippets,
  upsertSnippet,
  type SnippetStorageConfig,
} from './snippets'

export interface SnippetStore {
  /** 当前快照（同步返回，便于 React 初始化）。含回收站墓碑，UI 用 alive/trash 视图取子集 */
  current(): Snippet[]
  upsert(snippet: Snippet): void
  /**
   * 删除进回收站：写墓碑（deletedAt = now），内容原样保留，保留期内可恢复。
   * 云端模式下会触发 onRemove 钩子 → 入队服务端软删除。
   */
  trash(id: string): void
  /** 批量删除进回收站（「清空全部片段」用）：只落盘一次，回调逐条触发 */
  trashMany(ids: readonly string[]): void
  /** 在用条目上限：恢复前要查，满了再恢复会挤掉别的条目 */
  readonly maxEntries: number
  /**
   * 从回收站恢复：墓碑清零、updatedAt 推到当前时刻。
   * 在用条目已达上限时抛 RestoreCapError，避免截断时丢掉另一条。
   */
  restore(id: string): void
  /** 彻底删除单条（不可恢复）；仅对回收站里的墓碑生效 */
  purge(id: string): void
  /** 清空回收站：硬删全部墓碑 */
  emptyTrash(): void
  /** 清理到期墓碑（打开应用时惰性执行），返回清理条数 */
  purgeExpired(now?: number): number
  /** 立即硬删（回收站清空路径 / 同步引擎下行墓碑落地用） */
  remove(id: string): void
  /** 回收站视图：墓碑条目，按删除时间倒序，已排除到期未清理的 */
  trashEntries(now?: number): Snippet[]
  /** 全量替换（登录全量拉取、合并向导、登出回退） */
  replaceAll(snippets: Snippet[]): void
  /** 订阅变更；返回取消订阅函数 */
  subscribe(listener: (snippets: Snippet[]) => void): () => void
}

export interface LocalWriteHooks {
  /** 写透本地缓存后触发（云端 store 用它把变更推入同步队列） */
  onUpsert?: (snippet: Snippet) => void
  /** 本地删除后触发（云端 store 用它入队软删除） */
  onRemove?: (id: string) => void
}

export class LocalSnippetStore implements SnippetStore {
  private list: Snippet[]
  private readonly listeners = new Set<(snippets: Snippet[]) => void>()

  constructor(
    private readonly storage: SnippetStorageConfig,
    private readonly hooks: LocalWriteHooks = {},
  ) {
    const onDisk = storedEntryCount(storage)
    this.list = loadSnippetsFrom(storage)
    // 读取时清掉了到期墓碑（或被上限截断 / 丢掉损坏条目）：把清理结果写回磁盘，
    // 否则过期数据会一直占着额度——「到期自动删除」得真的把数据删掉，
    // 而不只是让它看不见。条数相等时不重写，启动不白花一次序列化。
    if (onDisk !== null && onDisk > this.list.length) this.persist()
  }

  get maxEntries(): number {
    return this.storage.maxEntries
  }

  current(): Snippet[] {
    return this.list
  }

  upsert(snippet: Snippet): void {
    this.list = upsertSnippet(this.list, snippet)
    this.persist()
    this.hooks.onUpsert?.(snippet)
    this.emit()
  }

  trash(id: string): void {
    this.trashMany([id])
  }

  trashMany(ids: readonly string[]): void {
    let next = this.list
    const affected: string[] = []
    for (const id of ids) {
      const entry = next.find((s) => s.id === id)
      // 已在回收站里再删一次：幂等，不重复入队也不刷新删除时间
      if (!entry || isTrashed(entry)) continue
      next = markTrashed(next, id)
      affected.push(id)
    }
    if (affected.length === 0) return
    this.list = next
    this.persist()
    for (const id of affected) {
      // 仅本地条目连 id 都不离开浏览器（「永不离开浏览器」的承诺）；
      // 服务端根本没这条，入队一条 DELETE 只会白跑一趟
      if (this.list.find((s) => s.id === id)?.localOnly) continue
      this.hooks.onRemove?.(id)
    }
    this.emit()
  }

  restore(id: string): void {
    const entry = this.list.find((s) => s.id === id)
    if (!entry || !isTrashed(entry)) return
    if (restoreBlockedByCap(this.list, this.storage.maxEntries)) {
      throw new RestoreCapError()
    }
    this.list = markRestored(this.list, id)
    this.persist()
    this.emit()
  }

  purge(id: string): void {
    const entry = this.list.find((s) => s.id === id)
    // 只对回收站里的条目生效：误传一个在用条目的 id 不该把它抹掉
    if (!entry || !isTrashed(entry)) return
    this.hardRemove([id])
    this.emit()
  }

  emptyTrash(): void {
    const ids = this.list.filter(isTrashed).map((s) => s.id)
    if (ids.length === 0) return
    this.hardRemove(ids)
    this.emit()
  }

  purgeExpired(now = Date.now()): number {
    const expired = this.list.filter((s) => isTrashExpired(s, now)).map((s) => s.id)
    if (expired.length === 0) return 0
    this.hardRemove(expired)
    this.emit()
    return expired.length
  }

  remove(id: string): void {
    this.hardRemove([id])
    this.hooks.onRemove?.(id)
    this.emit()
  }

  trashEntries(now = Date.now()): Snippet[] {
    return trashedSnippets(this.list, now)
  }

  replaceAll(snippets: Snippet[]): void {
    this.list = snippets
    this.persist()
    this.emit()
  }

  subscribe(listener: (snippets: Snippet[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 硬删且不触发写透钩子：回收站的彻底删除/清空不需要再往服务端入队软删除 */
  private hardRemove(ids: readonly string[]): void {
    this.list = dropSnippets(this.list, ids)
    this.persist()
  }

  private persist(): void {
    saveSnippetsTo(this.storage, this.list)
    const saved = loadSnippetsFrom(this.storage)
    // saveSnippetsTo 在存储彻底失败时会删掉键：不要把内存里还在的数据换成空列表
    if (saved.length === 0 && this.list.length > 0) return
    this.list = saved
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.list)
  }
}
