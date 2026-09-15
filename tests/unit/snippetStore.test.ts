import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSnippetStore } from '../../src/storage/SnippetStore'
import { LOCAL_SNIPPET_STORAGE, cloudCacheStorage } from '../../src/storage/snippets'
import type { Snippet } from '../../src/storage/snippets'

const CLOUD_CACHE_STORAGE = cloudCacheStorage(7)
const CLOUD_CACHE_STORAGE_KEY = CLOUD_CACHE_STORAGE.key

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  const now = Date.now()
  return {
    id: 's1',
    title: 't',
    content: 'c',
    langId: 'plaintext',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('LocalSnippetStore（SnippetStore 抽象的本地实现）', () => {
  it('upsert 落盘并通知订阅者；remove 生效', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    const seen: Snippet[][] = []
    const unsub = store.subscribe((list) => seen.push(list))

    store.upsert(snippet())
    expect(seen).toHaveLength(1)
    expect(store.current()).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('vimpaste.history.v1') ?? '[]')).toHaveLength(1)

    store.remove('s1')
    expect(store.current()).toHaveLength(0)
    expect(localStorage.getItem('vimpaste.history.v1')).toBeNull()

    unsub()
    store.upsert(snippet())
    expect(seen).toHaveLength(2) // 取消订阅后不再收到通知
  })

  it('replaceAll 覆盖并落盘（登录全量拉取 / 登出回退）', () => {
    const store = new LocalSnippetStore(CLOUD_CACHE_STORAGE)
    store.replaceAll([snippet({ id: 'a' }), snippet({ id: 'b' })])
    expect(store.current().map((s) => s.id)).toEqual(['a', 'b'])
    expect(JSON.parse(localStorage.getItem(CLOUD_CACHE_STORAGE_KEY) ?? '[]')).toHaveLength(2)
  })

  it('写透钩子：onUpsert / onRemove 回调触发（云端 store 用它接线同步引擎）', () => {
    const onUpsert = vi.fn()
    const onRemove = vi.fn()
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE, { onUpsert, onRemove })
    store.upsert(snippet())
    store.remove('s1')
    expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    expect(onRemove).toHaveBeenCalledWith('s1')
  })

  it('构造时从既有存储恢复（模拟刷新后重挂载）', () => {
    localStorage.setItem(
      'vimpaste.history.v1',
      JSON.stringify([{ id: 'old', title: '旧', content: 'echo old', langId: 'shell', createdAt: 1, updatedAt: 2 }]),
    )
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    expect(store.current()[0]).toMatchObject({ id: 'old', kind: 'command' })
  })
})

describe('LocalSnippetStore（回收站：墓碑保留 30 天）', () => {
  const DAY = 24 * 60 * 60 * 1000
  const KEY = LOCAL_SNIPPET_STORAGE.key

  function stored(): Snippet[] {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Snippet[]
  }

  it('trash：条目从片段库消失但仍在 localStorage 里，deletedAt 非空', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'a', content: 'echo hi' }))
    store.trash('a')

    expect(store.current()).toHaveLength(1) // 快照仍含墓碑（UI 用它派生回收站视图）
    expect(store.trashEntries()).toHaveLength(1)
    expect(stored()).toHaveLength(1)
    expect(stored()[0].deletedAt).toBeGreaterThan(0)
    expect(stored()[0].content).toBe('echo hi')
    expect(JSON.parse(JSON.stringify(store.current()[0]))).toMatchObject({ id: 'a' })
  })

  it('restore：墓碑清零、条目回到片段库', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'a' }))
    store.trash('a')
    store.restore('a')

    expect(store.trashEntries()).toHaveLength(0)
    expect(stored()[0].deletedAt).toBeNull()
    // 恢复后的条目置顶（updatedAt 推到当前时刻）
    store.upsert(snippet({ id: 'b', updatedAt: Date.now() - 10_000 }))
    store.restore('a')
    expect(store.current()[0].id).toBe('a')
  })

  it('purge：只对回收站里的条目生效，硬删后不再回到存储', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'live' }))
    store.purge('live') // 误传在用条目：不动
    expect(store.current()).toHaveLength(1)

    store.upsert(snippet({ id: 'gone' }))
    store.trash('gone')
    store.purge('gone')
    expect(store.current().map((s) => s.id)).toEqual(['live'])
    expect(stored().map((s) => s.id)).toEqual(['live'])
  })

  it('emptyTrash：硬删全部墓碑，在用条目不受影响', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'live' }))
    store.upsert(snippet({ id: 't1' }))
    store.upsert(snippet({ id: 't2' }))
    store.trash('t1')
    store.trash('t2')

    store.emptyTrash()
    expect(store.trashEntries()).toHaveLength(0)
    expect(store.current().map((s) => s.id)).toEqual(['live'])
  })

  it('purgeExpired：清掉到期墓碑并返回条数，未到期的保留', () => {
    const now = Date.now()
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'a' }))
    store.trash('a')

    // 尚未到期：不动
    expect(store.purgeExpired(now)).toBe(0)
    expect(store.trashEntries()).toHaveLength(1)

    // 模拟 31 天后重新打开应用
    expect(store.purgeExpired(now + 31 * DAY)).toBe(1)
    expect(store.current()).toHaveLength(0)
    expect(stored()).toHaveLength(0)
    expect(store.purgeExpired(now + 31 * DAY)).toBe(0) // 幂等
  })

  it('构造时就把到期墓碑挡在外面（惰性清理，不靠定时器）', () => {
    const now = Date.now()
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { ...snippet({ id: 'fresh' }), deletedAt: now - 1 * DAY },
        { ...snippet({ id: 'expired' }), deletedAt: now - 40 * DAY },
      ]),
    )
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    expect(store.current().map((s) => s.id)).toEqual(['fresh'])
  })

  it('写透钩子：trash 触发 onRemove（入队服务端软删除）；purge/emptyTrash 不触发', () => {
    const onRemove = vi.fn()
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE, { onRemove })
    store.upsert(snippet({ id: 'a' }))
    store.trash('a')
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith('a')

    // 彻底删除是本地回收站的终点，不该再往服务端入队一次「软删除」
    store.purge('a')
    expect(onRemove).toHaveBeenCalledTimes(1)

    store.upsert(snippet({ id: 'b' }))
    store.trash('b')
    expect(onRemove).toHaveBeenCalledTimes(2)
    store.emptyTrash()
    expect(onRemove).toHaveBeenCalledTimes(2)
  })

  it('trash 幂等：重复删除不刷新删除时间（保留期不被无限延长）', () => {
    const store = new LocalSnippetStore(LOCAL_SNIPPET_STORAGE)
    store.upsert(snippet({ id: 'a' }))
    store.trash('a')
    const first = stored()[0].deletedAt
    store.trash('a')
    expect(stored()[0].deletedAt).toBe(first)
  })
})
