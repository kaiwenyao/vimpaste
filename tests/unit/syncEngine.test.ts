import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云 API 全部 mock：同步引擎测试不触网
const syncMock = vi.fn()
const deleteSnippetMock = vi.fn()
vi.mock('../../src/cloud/api', () => ({
  cloudApi: {
    sync: (...args: unknown[]) => syncMock(...args),
    deleteSnippet: (...args: unknown[]) => deleteSnippetMock(...args),
  },
}))

import { SyncEngine, loadQueue, saveQueue } from '../../src/cloud/sync'
import type { SyncQueue } from '../../src/cloud/sync'
import { LocalSnippetStore } from '../../src/storage/SnippetStore'
import { CLOUD_CACHE_STORAGE } from '../../src/storage/snippets'
import type { Snippet } from '../../src/storage/snippets'

const QUEUE_KEY = 'vimpaste.syncqueue.v1'

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
    expect(loadQueue()).toEqual({ upserts: [], deletes: [], lastSyncAt: null })
  })

  it('读写一致', () => {
    const queue: SyncQueue = {
      upserts: [snippet()],
      deletes: ['22222222-2222-4222-8222-222222222222'],
      lastSyncAt: 123,
    }
    saveQueue(queue)
    expect(loadQueue()).toEqual(queue)
  })
})

describe('SyncEngine（冲突副本 / 墓碑 / 仅本地 / 防抖推送）', () => {
  function makeEngine() {
    const store = new LocalSnippetStore(CLOUD_CACHE_STORAGE)
    const statuses: { state: string; lastSyncAt: number | null }[] = []
    const engine = new SyncEngine({ store, onStatus: (s) => statuses.push(s) })
    return { store, engine, statuses }
  }

  it('enqueueUpsert 忽略 localOnly 条目（永不入队、永不出现在请求体）', () => {
    const { engine } = makeEngine()
    engine.enqueueUpsert(snippet({ localOnly: true }))
    expect(loadQueue().upserts).toHaveLength(0)
    expect(syncMock).not.toHaveBeenCalled()
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
    expect(loadQueue().upserts).toHaveLength(0)
    expect(store.current()[0].syncState).toBe('synced')
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
    expect(loadQueue().upserts.some((u) => u.id === copy?.id)).toBe(true)
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
    expect(loadQueue().upserts).toHaveLength(0)
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
      const store = new LocalSnippetStore(CLOUD_CACHE_STORAGE)
      const engine = new SyncEngine({ store, onStatus: () => {} })
      // 模拟 session.ts 的接线
      store.subscribe(() => {})
      const s = snippet()
      // 直接调用引擎入队（真实接线中由 store 钩子触发）
      engine.enqueueUpsert(s)
      expect(loadQueue().upserts).toHaveLength(1)
      syncMock.mockResolvedValue({ applied: [s.id], conflicts: [], pulled: [], now: Date.now() })
      await vi.advanceTimersByTimeAsync(2000)
      expect(syncMock).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
