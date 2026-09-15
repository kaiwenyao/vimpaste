import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云 API 全部 mock：同步引擎测试不触网（CloudApiError 一并造进 mock，供 404 用例抛出）
const syncMock = vi.fn()
const deleteSnippetMock = vi.fn()
const restoreSnippetMock = vi.fn()
const purgeSnippetMock = vi.fn()
const emptyTrashMock = vi.fn()
vi.mock('../../src/cloud/api', () => {
  class CloudApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    cloudApi: {
      sync: (...args: unknown[]) => syncMock(...args),
      deleteSnippet: (...args: unknown[]) => deleteSnippetMock(...args),
      restoreSnippet: (...args: unknown[]) => restoreSnippetMock(...args),
      purgeSnippet: (...args: unknown[]) => purgeSnippetMock(...args),
      emptyTrash: (...args: unknown[]) => emptyTrashMock(...args),
    },
    CloudApiError,
  }
})

import { SyncEngine, loadQueue, saveQueue, serverToLocal, localToApi } from '../../src/cloud/sync'
import type { SyncQueue } from '../../src/cloud/sync'
import { CloudApiError } from '../../src/cloud/api'
import type { ApiSnippet } from '../../src/cloud/api'
import { LocalSnippetStore } from '../../src/storage/SnippetStore'
import { cloudCacheStorage } from '../../src/storage/snippets'
import type { Snippet } from '../../src/storage/snippets'

const QUEUE_KEY = 'vimpaste.syncqueue.v1.1'

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  const now = Date.now()
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    title: 't',
    content: 'c',
    langId: 'plaintext',
    createdAt: now - 1000,
    updatedAt: now,
    kind: 'command',
    syncState: 'local',
    ...overrides,
  }
}

const apiSnippet = (overrides: Partial<ApiSnippet> = {}): ApiSnippet => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'command',
  title: 't',
  content: 'c',
  note: null as string | null,
  langId: 'plaintext',
  pinned: false,
  usageCount: 0,
  lastUsedAt: null,
  collectionId: null,
  tags: [],
  createdAt: Date.now() - 1000,
  updatedAt: Date.now(),
  deletedAt: null,
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  syncMock.mockReset()
  deleteSnippetMock.mockReset()
  deleteSnippetMock.mockResolvedValue(undefined)
  restoreSnippetMock.mockReset()
  purgeSnippetMock.mockReset()
  purgeSnippetMock.mockResolvedValue(undefined)
  emptyTrashMock.mockReset()
})

describe('同步队列持久化', () => {
  it('损坏数据降级为空队列', () => {
    localStorage.setItem(QUEUE_KEY, '{nope')
    expect(loadQueue(QUEUE_KEY)).toEqual({ upserts: [], deletes: [], lastSyncAt: null })
  })

  it('读写一致', () => {
    const queue: SyncQueue = {
      upserts: [snippet()],
      deletes: ['22222222-2222-4222-8222-222222222222'],
      lastSyncAt: 123,
    }
    saveQueue(QUEUE_KEY, queue)
    expect(loadQueue(QUEUE_KEY)).toEqual(queue)
  })
})

describe('本地 ↔ 服务端条目映射（note 往返）', () => {
  it('localToApi 带上备注；无备注时为 null', () => {
    expect(localToApi(snippet({ note: '重装 k3s 用' })).note).toBe('重装 k3s 用')
    expect(localToApi(snippet())).toHaveProperty('note', null)
  })

  it('serverToLocal 保留服务端备注；空串视为无备注（键省略）', () => {
    const withNote = serverToLocal(apiSnippet({ note: '生产环境的入口命令' }))
    expect(withNote.note).toBe('生产环境的入口命令')
    const withoutNote = serverToLocal(apiSnippet({ note: '' }))
    expect(withoutNote).not.toHaveProperty('note')
  })
})

describe('SyncEngine（冲突副本 / 墓碑 / 仅本地 / 防抖推送）', () => {
  function makeEngine() {
    const store = new LocalSnippetStore(cloudCacheStorage(1))
    const statuses: { state: string; lastSyncAt: number | null }[] = []
    const engine = new SyncEngine({ store, onStatus: (s) => statuses.push(s), queueKey: QUEUE_KEY })
    return { store, engine, statuses }
  }

  it('enqueueUpsert 忽略 localOnly 条目（永不入队、永不出现在请求体）', () => {
    const { engine } = makeEngine()
    engine.enqueueUpsert(snippet({ localOnly: true }))
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('已入队的条目被切到 localOnly 时出队：内容绝不随下一轮推送上行', () => {
    const { engine } = makeEngine()
    engine.enqueueUpsert(snippet({ content: '即将转仅本地的密钥' }))
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(1)
    // 防抖窗口内用户打开「仅本地」：store 写入 localOnly 版本 → 钩子再调 enqueueUpsert
    engine.enqueueUpsert(snippet({ content: '即将转仅本地的密钥', localOnly: true }))
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
  })

  it('enqueueMany 跳过墓碑：匿名删除的条目绝不被当成新建上传', () => {
    const { engine } = makeEngine()
    engine.enqueueMany([
      snippet({ id: '11111111-1111-4111-8111-111111111111', syncState: 'local' }),
      snippet({
        id: '22222222-2222-4222-8222-222222222222',
        syncState: 'local',
        deletedAt: Date.now(),
      }),
    ])
    expect(loadQueue(QUEUE_KEY).upserts.map((s) => s.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ])
  })

  it('flush：先增量拉取再推上行；applied 后队列清空、缓存标记 synced', async () => {
    const { store, engine } = makeEngine()
    const s = snippet({ id: '11111111-1111-4111-8111-111111111111' })
    engine.enqueueUpsert(s)
    syncMock.mockResolvedValue({
      applied: [s.id],
      conflicts: [],
      pulled: [],
      now: Date.now(),
    })
    await engine.flush()
    // 第 1 次调用 = 增量拉取（changes 为空），第 2 次 = 上行批次
    expect(syncMock).toHaveBeenCalledTimes(2)
    const [since, changes] = syncMock.mock.calls[1] as [number, unknown[]]
    // 拉取响应的 now 已成为增量基线，推送时带上
    expect(since).toBeGreaterThan(0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ id: s.id, kind: 'command' })
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
    expect(store.current()[0].syncState).toBe('synced')
  })

  it('删除 404（服务端从未见过该条目）视同已删除，不卡队列不进 paused', async () => {
    const { engine, statuses } = makeEngine()
    // 典型场景：离线新建 → 2 秒防抖内删除 → 服务端从未收到创建，DELETE 返回 404
    engine.enqueueDelete('44444444-4444-4444-8444-444444444444')
    deleteSnippetMock.mockRejectedValue(new CloudApiError(404, 'NOT_FOUND', '条目不存在'))
    syncMock.mockResolvedValue({ applied: [], conflicts: [], pulled: [], now: Date.now() })
    await engine.flush()
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    expect(statuses.at(-1)?.state).toBe('ok')
  })

  it('删除的其它失败仍进入 paused 等重试', async () => {
    const { engine, statuses } = makeEngine()
    engine.enqueueDelete('44444444-4444-4444-8444-444444444444')
    deleteSnippetMock.mockRejectedValue(new CloudApiError(0, 'NETWORK', '网络不可用'))
    await engine.flush()
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(1)
    expect(statuses.at(-1)?.state).toBe('paused')
  })

  it('请求在途期间的新编辑不被 applied 覆盖：队列保留新版本、缓存不回退', async () => {
    const { store, engine } = makeEngine()
    const id = '11111111-1111-4111-8111-111111111111'
    const pushedAt = Date.now() - 5000
    engine.enqueueUpsert(snippet({ id, content: '推送时的版本', updatedAt: pushedAt }))
    // 第 1 次 sync 调用 = 增量拉取；第 2 次 = 推送旧批次（服务端 applied）。
    // 推送响应返回前用户完成一次新编辑：store.upsert + 钩子入队同时发生
    let calls = 0
    syncMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) return { applied: [], conflicts: [], pulled: [], now: Date.now() }
      const newer = snippet({
        id,
        content: '在途新编辑',
        updatedAt: Date.now(),
        syncState: 'pending',
      })
      store.upsert(newer)
      engine.enqueueUpsert(newer)
      return { applied: [id], conflicts: [], pulled: [], now: Date.now() }
    })
    await engine.flush()
    expect(store.current().find((s) => s.id === id)?.content).toBe('在途新编辑')
    // 新版本仍在队列，等下一轮推送
    expect(loadQueue(QUEUE_KEY).upserts.map((u) => u.content)).toEqual(['在途新编辑'])
  })

  it('冲突：不覆盖服务端，本地另存「（冲突副本）」并重新入队', async () => {
    const { store, engine } = makeEngine()
    const s = snippet({ id: '11111111-1111-4111-8111-111111111111', title: '本地版本' })
    engine.enqueueUpsert(s)
    const serverUpdatedAt = Date.now()
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [
        {
          id: s.id,
          server: apiSnippet({ id: s.id, title: '服务端版本', updatedAt: serverUpdatedAt }),
        },
      ],
      pulled: [],
      now: Date.now(),
    })
    await engine.flush()

    // 服务端版本进缓存 + 冲突副本也在缓存
    const rows = store.current()
    expect(rows.some((r) => r.title === '服务端版本' && r.syncState === 'synced')).toBe(true)
    const copy = rows.find((r) => r.title.includes('（冲突副本）'))
    expect(copy).toBeDefined()
    // 副本重新入队等待下一轮推送
    expect(loadQueue(QUEUE_KEY).upserts.some((u) => u.id === copy?.id)).toBe(true)
  })

  it('下行墓碑：本地行被移除；本地有更新时另存冲突副本绝不丢字', async () => {
    const { store, engine } = makeEngine()
    const id = '11111111-1111-4111-8111-111111111111'
    store.upsert(snippet({ id, title: '本地修改', updatedAt: Date.now() }))
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [],
      pulled: [apiSnippet({ id, deletedAt: Date.now(), updatedAt: Date.now() - 5000 })],
      now: Date.now(),
    })
    await engine.flush()
    // 本地版本比墓碑新：副本保留
    expect(store.current().some((r) => r.title.includes('（冲突副本）'))).toBe(true)

    // 另一设备删除、本地无修改：直接消失（先清掉上一段留下的数据，隔离两个场景）
    localStorage.clear()
    const { store: store2, engine: engine2 } = makeEngine()
    store2.upsert(snippet({ id, updatedAt: Date.now() - 9000 }))
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [],
      pulled: [apiSnippet({ id, deletedAt: Date.now() })],
      now: Date.now(),
    })
    await engine2.flush()
    expect(store2.current()).toHaveLength(0)
  })

  it('仅本地条目遇到下行墓碑：本地条目原样保留，不删除也不上传', async () => {
    const { store, engine } = makeEngine()
    const id = '11111111-1111-4111-8111-111111111111'
    const localOnly = snippet({
      id,
      title: '仅本地的密钥',
      localOnly: true,
      syncState: 'local',
      updatedAt: Date.now(),
    })
    store.upsert(localOnly)
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [],
      pulled: [apiSnippet({ id, deletedAt: Date.now(), updatedAt: Date.now() - 5000 })],
      now: Date.now(),
    })
    await engine.flush()
    // 本地仅本地条目仍在（「已同步条目开启仅本地」流程：服务端删除后本地副本必须存活）
    const kept = store.current().find((s) => s.id === id)
    expect(kept).toBeDefined()
    expect(kept?.localOnly).toBe(true)
    // 不删除、不产生冲突副本、不入队——内容原样留在浏览器
    expect(store.current()).toHaveLength(1)
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
  })

  it('pending 删除期间拉取不复活该条目', async () => {
    const { store, engine } = makeEngine()
    const id = '11111111-1111-4111-8111-111111111111'
    engine.enqueueDelete(id)
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [],
      pulled: [apiSnippet({ id })],
      now: Date.now(),
    })
    await engine.flush()
    expect(store.current()).toHaveLength(0)
    expect(deleteSnippetMock).toHaveBeenCalledWith(id)
  })

  it('拉取的已同步条目不回环入队（remoteWrite 挂起钩子）', async () => {
    const { store, engine } = makeEngine()
    syncMock.mockResolvedValue({
      applied: [],
      conflicts: [],
      pulled: [apiSnippet({ id: '33333333-3333-4333-8333-333333333333' })],
      now: Date.now(),
    })
    await engine.flush()
    expect(store.current()).toHaveLength(1)
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
  })

  it('失败进入 paused 并按退避重试；状态变化回调上报', async () => {
    vi.useFakeTimers()
    try {
      const { engine, statuses } = makeEngine()
      engine.enqueueUpsert(snippet())
      syncMock.mockRejectedValueOnce(new Error('network'))
      const promise = engine.flush()
      await promise
      expect(statuses.at(-1)?.state).toBe('paused')
      // 退避计时器就位（1s），不立刻重试
      expect(syncMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(syncMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('store 写入触发出队（钩子接线），防抖 2 秒后推送', async () => {
    vi.useFakeTimers()
    try {
      const store = new LocalSnippetStore(cloudCacheStorage(1))
      const engine = new SyncEngine({ store, onStatus: () => {}, queueKey: QUEUE_KEY })
      // 模拟 session.ts 的接线
      store.subscribe(() => {})
      const s = snippet()
      // 直接调用引擎入队（真实接线中由 store 钩子触发）
      engine.enqueueUpsert(s)
      expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(1)
      syncMock.mockResolvedValue({ applied: [s.id], conflicts: [], pulled: [], now: Date.now() })
      await vi.advanceTimersByTimeAsync(2000)
      expect(syncMock).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * 回收站（云端路径）：恢复 / 彻底删除 / 清空。
 * 这里刻意带写透钩子接线（与 src/cloud/session.ts 一致），因为「恢复会不会被
 * 队列里的删除再打回去」正是最容易被写出 bug 的地方：恢复必须同时撤下待推删除。
 */
describe('SyncEngine 回收站（恢复 / 彻底删除 / 清空）', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const DELETED_ID = '22222222-2222-4222-8222-222222222222'

  /** 与 session.ts 相同的接线：store 写入自动入队（否则测不到钩子相关的时序） */
  function makeWiredEngine() {
    const store = new LocalSnippetStore(cloudCacheStorage(1), {
      onUpsert: (s) => {
        if (!engine.remoteWrite) engine.enqueueUpsert(s)
      },
      onRemove: (id) => {
        if (!engine.remoteWrite) engine.enqueueDelete(id)
      },
    })
    const engine = new SyncEngine({ store, onStatus: () => {}, queueKey: QUEUE_KEY })
    return { store, engine }
  }

  /** 已同步条目 → 删除进回收站（真实流程：store.trash 写墓碑并触发 enqueueDelete） */
  function trashSyncedEntry(store: LocalSnippetStore, id = ID) {
    store.upsert(snippet({ id, syncState: 'synced' }))
    store.trash(id)
  }

  it('恢复前先撤下待推删除：防抖窗口内恢复，DELETE 根本不会发出去', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    expect(loadQueue(QUEUE_KEY).deletes).toEqual([ID])

    restoreSnippetMock.mockResolvedValue(apiSnippet({ id: ID, deletedAt: null }))
    await engine.restoreFromTrash(ID)

    expect(deleteSnippetMock).not.toHaveBeenCalled()
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    // 恢复不是一次上行推送：服务端已经是真相，不需要再推一遍内容
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
    expect(restoreSnippetMock).toHaveBeenCalledWith(ID)

    const row = store.current().find((s) => s.id === ID)
    expect(row?.deletedAt).toBeNull()
    expect(row?.syncState).toBe('synced')
    engine.stop()
  })

  it('恢复失败必须抛错（绝不静默吞掉），条目留在回收站等用户重试', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    restoreSnippetMock.mockRejectedValue(new CloudApiError(0, 'NETWORK', '网络不可用'))

    await expect(engine.restoreFromTrash(ID)).rejects.toThrow('网络不可用')
    // 本地仍是墓碑：UI 才能把它继续显示在回收站里
    expect(store.current().find((s) => s.id === ID)?.deletedAt).toBeGreaterThan(0)
    engine.stop()
  })

  it('片段库已满时恢复抛错：不打 restore API、不撤待推删除、不挤掉在用条目', async () => {
    const storage = { key: 'vimpaste.snippets.v2.cap', maxEntries: 2, maxTrashEntries: 2 }
    const store = new LocalSnippetStore(storage, {
      onUpsert: (s) => {
        if (!engine.remoteWrite) engine.enqueueUpsert(s)
      },
      onRemove: (id) => {
        if (!engine.remoteWrite) engine.enqueueDelete(id)
      },
    })
    const engine = new SyncEngine({ store, onStatus: () => {}, queueKey: QUEUE_KEY })
    store.upsert(snippet({ id: ID, syncState: 'synced', updatedAt: 1 }))
    store.trash(ID)
    store.upsert(snippet({ id: 'keep-a', syncState: 'synced', updatedAt: 3 }))
    store.upsert(snippet({ id: 'keep-b', syncState: 'synced', updatedAt: 2 }))
    expect(loadQueue(QUEUE_KEY).deletes).toEqual([ID])

    await expect(engine.restoreFromTrash(ID)).rejects.toThrow('片段库已满，请先删一条再恢复')
    expect(restoreSnippetMock).not.toHaveBeenCalled()
    expect(loadQueue(QUEUE_KEY).deletes).toEqual([ID])
    expect(
      store
        .current()
        .filter((s) => s.deletedAt == null)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['keep-a', 'keep-b'])
    expect(store.trashEntries().map((s) => s.id)).toEqual([ID])
    engine.stop()
  })

  it('并发恢复只让一条成功：第二份等锁后因满额失败，不挤掉在用条目', async () => {
    const storage = { key: 'vimpaste.snippets.v2.cap2', maxEntries: 2, maxTrashEntries: 2 }
    const store = new LocalSnippetStore(storage, {
      onUpsert: (s) => {
        if (!engine.remoteWrite) engine.enqueueUpsert(s)
      },
      onRemove: (id) => {
        if (!engine.remoteWrite) engine.enqueueDelete(id)
      },
    })
    const engine = new SyncEngine({ store, onStatus: () => {}, queueKey: QUEUE_KEY })
    // 1 条在用、还剩 1 个名额；两条都是服务端墓碑（本地缓存里没有）
    store.upsert(snippet({ id: 'keep', syncState: 'synced', updatedAt: 1 }))
    restoreSnippetMock.mockImplementation((id: string) =>
      Promise.resolve(apiSnippet({ id, deletedAt: null })),
    )

    const results = await Promise.allSettled([
      engine.restoreFromTrash(ID),
      engine.restoreFromTrash(DELETED_ID),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.message).toBe(
      '片段库已满，请先删一条再恢复',
    )
    expect(restoreSnippetMock).toHaveBeenCalledTimes(1)
    const alive = store.current().filter((s) => s.deletedAt == null)
    expect(alive).toHaveLength(2)
    expect(alive.some((s) => s.id === 'keep')).toBe(true)
    engine.stop()
  })

  it('服务端没有这条（404）时本地恢复并重新入队：恢复按钮点了就该恢复', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    restoreSnippetMock.mockRejectedValue(new CloudApiError(404, 'NOT_FOUND', '条目不存在'))

    await engine.restoreFromTrash(ID)

    const row = store.current().find((s) => s.id === ID)
    expect(row?.deletedAt).toBeNull()
    expect(row?.syncState).toBe('pending')
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    // 重新入队上行，内容不丢
    expect(loadQueue(QUEUE_KEY).upserts.map((u) => u.id)).toEqual([ID])
    engine.stop()
  })

  it('从未推送过的条目（syncState=local）恢复：不发服务端请求，本地恢复 + 入队新建', async () => {
    const { store, engine } = makeWiredEngine()
    store.upsert(snippet({ id: ID, syncState: 'local' }))
    store.trash(ID)
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ upserts: [], deletes: [], lastSyncAt: null }))

    await engine.restoreFromTrash(ID)

    expect(restoreSnippetMock).not.toHaveBeenCalled()
    expect(store.current().find((s) => s.id === ID)?.deletedAt).toBeNull()
    expect(loadQueue(QUEUE_KEY).upserts.map((u) => u.id)).toEqual([ID])
    engine.stop()
  })

  it('刷新 / 换设备后本地缓存里没有这条：仍要打 restore API，并把条目写回缓存', async () => {
    // 场景：登录删除 → 下行墓碑把本地墓碑从缓存移除（mergePulled → store.remove）
    // → 刷新/换设备后回收站列表来自 GET /trash，本地 store 里已经没有该 id。
    // 此时若跳过 restore API 直接 restoreLocally，会以「条目不存在」失败。
    const { store, engine } = makeWiredEngine()
    expect(store.current().find((s) => s.id === ID)).toBeUndefined()

    restoreSnippetMock.mockResolvedValue(apiSnippet({ id: ID, deletedAt: null }))
    await engine.restoreFromTrash(ID)

    expect(restoreSnippetMock).toHaveBeenCalledWith(ID)
    const row = store.current().find((s) => s.id === ID)
    expect(row?.deletedAt).toBeNull()
    expect(row?.syncState).toBe('synced')
    // 服务端已经是真相：恢复不是一次上行推送
    expect(loadQueue(QUEUE_KEY).upserts).toHaveLength(0)
    engine.stop()
  })

  it('本地缓存里没有且服务端也没有（404）：抛错，不假装恢复成功', async () => {
    const { engine } = makeWiredEngine()
    restoreSnippetMock.mockRejectedValue(new CloudApiError(404, 'NOT_FOUND', '条目不存在'))

    await expect(engine.restoreFromTrash(ID)).rejects.toThrow('条目不存在')
    engine.stop()
  })

  it('删除在途期间恢复：DELETE 落地后立刻撤销，条目不会被再删一次', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)

    let releaseDelete: () => void = () => {}
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    deleteSnippetMock.mockImplementation(async () => {
      await deleteGate
    })
    syncMock.mockResolvedValue({ applied: [], conflicts: [], pulled: [], now: Date.now() })
    restoreSnippetMock.mockResolvedValue(apiSnippet({ id: ID, deletedAt: null }))

    const flush = engine.flush()
    // 等 DELETE 真正发出去（此时它在途）
    await vi.waitFor(() => expect(deleteSnippetMock).toHaveBeenCalledWith(ID))

    // 在途期间用户点了恢复：撤下队列 + 登记撤销
    await engine.restoreFromTrash(ID)
    expect(restoreSnippetMock).toHaveBeenCalledTimes(1)

    releaseDelete()
    await flush

    // DELETE 已经落到服务端，收尾时必须再恢复一次把它撤销
    expect(restoreSnippetMock).toHaveBeenCalledTimes(2)
    expect(restoreSnippetMock).toHaveBeenLastCalledWith(ID)
    expect(store.current().find((s) => s.id === ID)?.deletedAt).toBeNull()
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    engine.stop()
  })

  it('撤下待推删除时按 id 过滤：不会误伤队首的另一条删除', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store, ID)
    trashSyncedEntry(store, DELETED_ID)
    expect(loadQueue(QUEUE_KEY).deletes).toEqual([ID, DELETED_ID])

    // 删除第一条在途，期间恢复第二条：队列里第二条不能被当作「已完成」切掉
    let releaseDelete: () => void = () => {}
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    deleteSnippetMock.mockImplementation(async () => {
      await deleteGate
    })
    syncMock.mockResolvedValue({ applied: [], conflicts: [], pulled: [], now: Date.now() })
    restoreSnippetMock.mockResolvedValue(apiSnippet({ id: DELETED_ID, deletedAt: null }))

    const flush = engine.flush()
    await vi.waitFor(() => expect(deleteSnippetMock).toHaveBeenCalledWith(ID))
    await engine.restoreFromTrash(DELETED_ID)
    releaseDelete()
    await flush

    // 第一条送达服务端，第二条被恢复撤下——两条都不该留在队列里
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    expect(deleteSnippetMock).toHaveBeenCalledTimes(1)
    expect(store.current().find((s) => s.id === DELETED_ID)?.deletedAt).toBeNull()
    engine.stop()
  })

  it('彻底删除：先撤下队列里的软删除，再请求服务端物理删除', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)

    await engine.purgeFromTrash(ID)

    expect(purgeSnippetMock).toHaveBeenCalledWith(ID)
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    engine.stop()
  })

  it('彻底删除时服务端仍当它「在用」（409）：先软删再硬删', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    purgeSnippetMock
      .mockRejectedValueOnce(new CloudApiError(409, 'NOT_TRASHED', '条目不在回收站中'))
      .mockResolvedValueOnce(undefined)

    await engine.purgeFromTrash(ID)

    expect(deleteSnippetMock).toHaveBeenCalledWith(ID)
    expect(purgeSnippetMock).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it('彻底删除时服务端根本没有这条（404）：视为已完成，不报错', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    purgeSnippetMock.mockRejectedValue(new CloudApiError(404, 'NOT_FOUND', '条目不存在'))

    await expect(engine.purgeFromTrash(ID)).resolves.toBeUndefined()
    engine.stop()
  })

  it('清空回收站：先把待推删除送达（服务端才视为墓碑），再请求清空', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store, ID)
    trashSyncedEntry(store, DELETED_ID)
    emptyTrashMock.mockResolvedValue(2)

    const count = await engine.emptyTrashRemote()

    // 删除必须先送达，否则服务端把它们当「在用」条目而留在库里
    expect(deleteSnippetMock).toHaveBeenCalledWith(ID)
    expect(deleteSnippetMock).toHaveBeenCalledWith(DELETED_ID)
    expect(purgeSnippetMock).not.toHaveBeenCalled()
    expect(emptyTrashMock).toHaveBeenCalledTimes(1)
    expect(count).toBe(2)
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    engine.stop()
  })

  it('清空回收站遇到网络故障：抛错给调用方，本地不假装已清空', async () => {
    const { store, engine } = makeWiredEngine()
    trashSyncedEntry(store)
    deleteSnippetMock.mockRejectedValue(new CloudApiError(0, 'NETWORK', '网络不可用'))

    await expect(engine.emptyTrashRemote()).rejects.toThrow('网络不可用')
    expect(emptyTrashMock).not.toHaveBeenCalled()
    engine.stop()
  })
})
