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
