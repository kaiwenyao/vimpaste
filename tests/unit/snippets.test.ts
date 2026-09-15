import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOUD_CACHE_STORAGE_PREFIX,
  LOCAL_STORAGE_KEY,
  MAX_CACHED_SNIPPETS,
  MAX_LOCAL_SNIPPETS,
  TRASH_RETENTION_DAYS,
  dropSnippets,
  isTrashed,
  loadSnippetsFrom,
  LOCAL_SNIPPET_STORAGE,
  cloudCacheStorage,
  markRestored,
  markTrashed,
  migrateV1ToV2,
  purgeExpiredTombstones,
  sanitizeSnippet,
  saveSnippetsTo,
  splitByTrash,
  trashDaysLeft,
  trashedSnippets,
  upsertSnippet,
} from '../../src/storage/snippets'
import type { Snippet } from '../../src/storage/snippets'

const TEST_USER_ID = 42
const CLOUD_CACHE_STORAGE = cloudCacheStorage(TEST_USER_ID)
const CLOUD_CACHE_STORAGE_KEY = CLOUD_CACHE_STORAGE.key

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

  it('备注：去空白后入库，空白视为无备注（键省略），超长截断', () => {
    const s = sanitizeSnippet({ id: 'a', content: 'x', note: '  重装 k3s 用  ' })
    expect(s?.note).toBe('重装 k3s 用')
    expect(sanitizeSnippet({ id: 'a', content: 'x', note: '   ' })).not.toHaveProperty('note')
    expect(sanitizeSnippet({ id: 'a', content: 'x', note: 42 })).not.toHaveProperty('note')
    const long = sanitizeSnippet({ id: 'a', content: 'x', note: 'n'.repeat(3000) })
    expect(long?.note).toHaveLength(2000)
  })

  it('标题截断到 200 字符上限（与服务端 schema 对齐）', () => {
    const s = sanitizeSnippet({ id: 'a', content: 'x', title: 't'.repeat(300) })
    expect(s?.title).toHaveLength(200)
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

describe('migrateV1ToV2（登录迁移，按用户分键，v1 键保留回滚窗口）', () => {
  it('v1 存在且该用户的 v2 不存在：读 v1 → 补字段 → 写 v2；v1 键原样保留', () => {
    const v1 = [
      {
        id: 'old-1',
        title: '旧命令',
        content: 'echo old',
        langId: 'shell',
        createdAt: 1,
        updatedAt: 2,
      },
    ]
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(v1))

    const migrated = migrateV1ToV2(TEST_USER_ID)
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({ id: 'old-1', kind: 'command', syncState: 'local' })
    // v1 键保留（一个版本的回滚窗口）
    expect(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]')[0].id).toBe('old-1')
    expect(localStorage.getItem(CLOUD_CACHE_STORAGE_KEY)).toContain('old-1')
    // 键按用户隔离：别的用户的 v2 键不受影响
    expect(cloudCacheStorage(TEST_USER_ID + 1).key).toBe(
      `${CLOUD_CACHE_STORAGE_PREFIX}.${TEST_USER_ID + 1}`,
    )
  })

  it('v2 已存在时不覆盖（幂等）；v1 缺失时直接读 v2', () => {
    localStorage.setItem(CLOUD_CACHE_STORAGE_KEY, JSON.stringify([snippet({ id: 'cloud-1' })]))
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: 'old-1', content: 'echo old' }]))
    const result = migrateV1ToV2(TEST_USER_ID)
    expect(result.map((s) => s.id)).toEqual(['cloud-1'])
  })

  it('v1 损坏时静默降级为空列表且写出空 v2', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, '{not json')
    expect(migrateV1ToV2(TEST_USER_ID)).toEqual([])
    expect(loadSnippetsFrom(CLOUD_CACHE_STORAGE)).toEqual([])
  })
})

describe('云端缓存（vimpaste.snippets.v2.<userId>，500 条）', () => {
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

describe('回收站：墓碑保留 30 天（本地路径与 v1 键共用同一份存储）', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('删除后条目仍在 localStorage 里，且 deletedAt 非空、内容一字不少', () => {
    const now = Date.now()
    const list = markTrashed(
      [snippet({ id: 'a', content: 'curl -sfL https://get.k3s.io | sh -' })],
      'a',
      now,
    )
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, list)

    const raw = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]')
    expect(raw).toHaveLength(1)
    expect(raw[0]).toMatchObject({ id: 'a', deletedAt: now })
    expect(raw[0].content).toBe('curl -sfL https://get.k3s.io | sh -')

    // 读回来仍是墓碑：active 视图为空，回收站视图有 1 条
    const loaded = loadSnippetsFrom(LOCAL_SNIPPET_STORAGE)
    expect(loaded.filter((s) => !isTrashed(s))).toHaveLength(0)
    expect(trashedSnippets(loaded).map((s) => s.id)).toEqual(['a'])
  })

  it('超过 30 天的墓碑在加载时被清除，未到期的原样保留', () => {
    const now = Date.now()
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, [
      { ...snippet({ id: 'fresh' }), deletedAt: now - 1 * DAY },
      { ...snippet({ id: 'just-30d' }), deletedAt: now - TRASH_RETENTION_DAYS * DAY },
      { ...snippet({ id: 'expired' }), deletedAt: now - 31 * DAY },
    ])
    const loaded = loadSnippetsFrom(LOCAL_SNIPPET_STORAGE)
    // 满 30 天即到期（>=），31 天前的更留不住
    expect(loaded.map((s) => s.id)).toEqual(['fresh'])
    expect(purgeExpiredTombstones(loaded, now).map((s) => s.id)).toEqual(['fresh'])
  })

  it('墓碑不占用 active 的 30 条上限：删满 30 条也不会挤掉在用的条目', () => {
    const now = Date.now()
    const active = Array.from({ length: MAX_LOCAL_SNIPPETS }, (_, i) =>
      snippet({ id: `a${i}`, updatedAt: now - i }),
    )
    const tombstones = Array.from({ length: MAX_LOCAL_SNIPPETS }, (_, i) => ({
      ...snippet({ id: `t${i}`, updatedAt: now - 5000 - i }),
      deletedAt: now - i,
    }))
    saveSnippetsTo(LOCAL_SNIPPET_STORAGE, [...active, ...tombstones])

    const loaded = loadSnippetsFrom(LOCAL_SNIPPET_STORAGE)
    expect(loaded.filter((s) => !isTrashed(s))).toHaveLength(MAX_LOCAL_SNIPPETS)
    expect(trashedSnippets(loaded)).toHaveLength(MAX_LOCAL_SNIPPETS)
    // 磁盘上 60 条：墓碑没有把 active 名额吃掉
    expect(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]')).toHaveLength(60)
  })

  it('恢复后条目回到 active 列表（墓碑清零、置顶）', () => {
    const now = Date.now()
    let list = [
      { ...snippet({ id: 'a' }), deletedAt: now - DAY },
      snippet({ id: 'b', updatedAt: now }),
    ]
    expect(trashedSnippets(list).map((s) => s.id)).toEqual(['a'])
    list = markRestored(list, 'a', now + 1)
    expect(list[0].id).toBe('a')
    expect(list[0].deletedAt).toBeNull()
    expect(trashedSnippets(list)).toHaveLength(0)
    expect(list.filter((s) => !isTrashed(s)).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('删除是幂等的：重复 trash 不刷新删除时间；markTrashed 不动 updatedAt', () => {
    const now = Date.now()
    const original = snippet({ id: 'a' })
    const once = markTrashed([original], 'a', now)
    const twice = markTrashed(once, 'a', now + 9999)
    expect(twice[0].deletedAt).toBe(now)
    expect(twice[0].updatedAt).toBe(original.updatedAt)
  })

  it('剩余天数：刚删是 30 天，29 天前删是 1 天，过期是 0', () => {
    const now = 1_700_000_000_000
    expect(trashDaysLeft(now, now)).toBe(TRASH_RETENTION_DAYS)
    expect(trashDaysLeft(now - 29 * DAY, now)).toBe(1)
    expect(trashDaysLeft(now - 30 * DAY, now)).toBe(0)
    expect(trashDaysLeft(now - 99 * DAY, now)).toBe(0)
  })

  it('splitByTrash 分桶：各自截断、墓碑按删除时间倒序、dropSnippets 只删传入的 id', () => {
    const now = Date.now()
    const entries = [
      snippet({ id: 'a', updatedAt: now - 1 }),
      snippet({ id: 'b', updatedAt: now - 2 }),
      { ...snippet({ id: 'old-delete' }), deletedAt: now - 2 * DAY },
      { ...snippet({ id: 'new-delete' }), deletedAt: now - 1 * DAY },
    ]
    const { active, trash } = splitByTrash(entries, { maxEntries: 1, maxTrashEntries: 1 }, now)
    expect(active.map((s) => s.id)).toEqual(['a'])
    expect(trash.map((s) => s.id)).toEqual(['new-delete'])
    expect(dropSnippets(entries, ['a']).map((s) => s.id)).toEqual(['b', 'old-delete', 'new-delete'])
  })
})
