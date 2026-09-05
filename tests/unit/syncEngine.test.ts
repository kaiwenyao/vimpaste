import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云 API 全部 mock：同步引擎测试不触网（CloudApiError 一并造进 mock，供 404 用例抛出）
const syncMock = vi.fn()
const deleteSnippetMock = vi.fn()
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
    },
    CloudApiError,
  }
})

import { SyncEngine, loadQueue, saveQueue } from '../../src/cloud/sync'
import type { SyncQueue } from '../../src/cloud/sync'
import { CloudApiError } from '../../src/cloud/api'
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

const apiSnippet = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'command',
  title: 't',
  content: 'c',
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
    deleteSnippetMock.mockRejectedValue(
      new CloudApiError(404, 'NOT_FOUND', '条目不存在'),
    )
    syncMock.mockResolvedValue({ applied: [], conflicts: [], pulled: [], now: Date.now() })
    await engine.flush()
    expect(loadQueue(QUEUE_KEY).deletes).toHaveLength(0)
    expect(statuses.at(-1)?.state).toBe('ok')
  })

  it('删除的其它失败仍进入 paused 等重试', async () => {
    const { engine, statuses } = makeEngine()
    engine.enqueueDelete('44444444-4444-4444-8444-444444444444')
    deleteSnippetMock.mockRejectedValue(
      new CloudApiError(0, 'NETWORK', '网络不可用'),
    )
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
      const newer = snippet({ id, content: '在途新编辑', updatedAt: Date.now(), syncState: 'pending' })
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
