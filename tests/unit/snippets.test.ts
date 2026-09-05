import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOUD_CACHE_STORAGE_KEY,
  LOCAL_STORAGE_KEY,
  MAX_CACHED_SNIPPETS,
  MAX_LOCAL_SNIPPETS,
  loadSnippetsFrom,
  LOCAL_SNIPPET_STORAGE,
  CLOUD_CACHE_STORAGE,
  migrateV1ToV2,
  sanitizeSnippet,
  saveSnippetsTo,
  upsertSnippet,
} from '../../src/storage/snippets'
import type { Snippet } from '../../src/storage/snippets'

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  const now = Date.now()
  return {
    id: 's1',
    title: 'curl 命令',
    content: "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -",
    langId: 'shell',
    createdAt: now - 1000,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('sanitizeSnippet（白名单清洗）', () => {
  it('非法条目丢弃，未知字段不透传', () => {
    expect(sanitizeSnippet({ id: '', content: 'x' })).toBeNull()
    expect(sanitizeSnippet({ id: 'a', content: '' })).toBeNull()
    expect(sanitizeSnippet({ id: 'a', content: 'x'.repeat(100_001) })).toBeNull()
    expect(sanitizeSnippet('junk')).toBeNull()
    const clean = sanitizeSnippet({ id: 'a', content: 'echo hi', evil: 'secret' })
    expect(clean).toMatchObject({ id: 'a', content: 'echo hi' })
    expect(JSON.stringify(clean)).not.toContain('secret')
  })

  it('补默认字段：kind 一律 command、pinned/localOnly 为 false、syncState 为 local', () => {
    const s = sanitizeSnippet({ id: 'a', content: 'echo hi' })
    expect(s).toMatchObject({
      kind: 'command',
      pinned: false,
      localOnly: false,
      syncState: 'local',
      collectionId: null,
      deletedAt: null,
    })
  })

  it('kind 只接受 prompt/command，其它值归为 command；标签去重、去空白、上限 20', () => {
    expect(sanitizeSnippet({ id: 'a', content: 'x', kind: 'bogus' })?.kind).toBe('command')
    expect(sanitizeSnippet({ id: 'a', content: 'x', kind: 'prompt' })?.kind).toBe('prompt')
    const s = sanitizeSnippet({
      id: 'a',
      content: 'x',
      tags: [' a ', 'a', '', 'b', ...Array.from({ length: 25 }, (_, i) => `t${i}`)],
    })
    expect(s?.tags).toHaveLength(20)
    expect(s?.tags?.[0]).toBe('a')
  })
})

describe('本地存储（匿名路径沿用 vimpaste.history.v1）', () => {
  it('写入与读取一致，超过 30 条截断保留最新', () => {
    const list = Array.from({ length: 35 }, (_, i) => snippet({ id: `s${i}`, updatedAt: i }))
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, list)
    const loaded = loadSnippetsFrom(LOCAL_SNIPPET_STORAGE)
    expect(loaded).toHaveLength(MAX_LOCAL_SNIPPETS)
    expect(loaded[0].id).toBe('s34')
    expect(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]')).toHaveLength(30)
  })

  it('清空时移除存储键（与 v1 行为一致）', () => {
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, [snippet()])
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).not.toBeNull()
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, [])
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull()
  })

  it('upsertSnippet：新条目置顶、同 id 去重、按 updatedAt 排序', () => {
    let list = upsertSnippet([], snippet({ id: 'a', updatedAt: 1 }))
    list = upsertSnippet(list, snippet({ id: 'b', updatedAt: 2 }))
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
    list = upsertSnippet(list, snippet({ id: 'a', updatedAt: 3 }))
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('QuotaExceeded 时从最旧开始丢弃重试，最终不抛错', () => {
    const list = [snippet({ id: 'a' }), snippet({ id: 'b' })]
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => saveSnippetsTo(LOCAL_SNIPPET_STORAGE, list)).not.toThrow()
    setItem.mockRestore()
  })
})

describe('migrateV1ToV2（登录迁移，v1 键保留回滚窗口）', () => {
  it('v1 存在且 v2 不存在：读 v1 → 补字段 → 写 v2；v1 键原样保留', () => {
    const v1 = [
      { id: 'old-1', title: '旧命令', content: 'echo old', langId: 'shell', createdAt: 1, updatedAt: 2 },
    ]
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(v1))

    const migrated = migrateV1ToV2()
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({ id: 'old-1', kind: 'command', syncState: 'local' })
    // v1 键保留（一个版本的回滚窗口）
    expect(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]')[0].id).toBe('old-1')
    expect(localStorage.getItem(CLOUD_CACHE_STORAGE_KEY)).toContain('old-1')
  })

  it('v2 已存在时不覆盖（幂等）；v1 缺失时直接读 v2', () => {
    localStorage.setItem(CLOUD_CACHE_STORAGE_KEY, JSON.stringify([snippet({ id: 'cloud-1' })]))
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: 'old-1', content: 'echo old' }]))
    const result = migrateV1ToV2()
    expect(result.map((s) => s.id)).toEqual(['cloud-1'])
  })

  it('v1 损坏时静默降级为空列表且写出空 v2', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, '{not json')
    expect(migrateV1ToV2()).toEqual([])
    expect(loadSnippetsFrom(CLOUD_CACHE_STORAGE)).toEqual([])
  })
})

describe('云端缓存（vimpaste.snippets.v2，500 条）', () => {
  it('上限 500 条，条目可携带 kind/pinned/localOnly 等扩展字段', () => {
    const list = Array.from({ length: 501 }, (_, i) =>
      snippet({ id: `s${i}`, updatedAt: i, kind: 'prompt', pinned: i % 2 === 0 }),
    )
    saveSnippetsTo(CLOUD_CACHE_STORAGE, list)
    const loaded = loadSnippetsFrom(CLOUD_CACHE_STORAGE)
    expect(loaded).toHaveLength(MAX_CACHED_SNIPPETS)
    expect(loaded[0].kind).toBe('prompt')
    expect(loaded[0].pinned).toBe(true)
  })
})
