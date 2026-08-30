import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveTitle, loadHistory, saveHistory, upsertHistory } from '../../src/storage/history'
import type { HistoryEntry } from '../../src/storage/history'

const KEY = 'vimpaste.history.v1'

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: overrides.id ?? 'id-1',
    title: overrides.title ?? 'curl 命令',
    content: overrides.content ?? "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -",
    langId: overrides.langId ?? 'shell',
    createdAt: overrides.createdAt ?? 1700000000000,
    updatedAt: overrides.updatedAt ?? 1700000000000,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('deriveTitle', () => {
  it('取第一条非空行并压缩空白', () => {
    expect(deriveTitle('\n  \n  apt-get   install\nfoo')).toBe('apt-get install')
  })

  it('超长标题截断并加省略号', () => {
    const title = deriveTitle('x'.repeat(100))
    expect(title.length).toBeLessThanOrEqual(49)
    expect(title.endsWith('…')).toBe(true)
  })

  it('空内容回退占位标题', () => {
    expect(deriveTitle('')).toBe('（空）')
    expect(deriveTitle('\n \n')).toBe('（空）')
  })
})

describe('loadHistory（白名单清洗）', () => {
  it('空存储返回空数组', () => {
    expect(loadHistory()).toEqual([])
  })

  it('损坏数据与非数组 JSON 返回空数组', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadHistory()).toEqual([])
    localStorage.setItem(KEY, '{"id":"x"}')
    expect(loadHistory()).toEqual([])
  })

  it('保存后读取一致', () => {
    const list = [entry({ id: 'a', updatedAt: 2 }), entry({ id: 'b', updatedAt: 1 })]
    saveHistory(list)
    expect(loadHistory()).toEqual(list)
  })

  it('非法条目被丢弃，未知字段不透传', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: '', content: 'x' }, // 无 id
        { id: 'ok', content: 42 }, // content 非字符串
        { id: 'ok2', evil: 'secret', content: 'echo hi', langId: 'nope' },
        'junk',
        null,
      ]),
    )
    const list = loadHistory()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('ok2')
    expect(list[0].langId).toBe('plaintext')
    expect(JSON.stringify(list)).not.toContain('secret')
  })

  it('空内容与超长内容条目被丢弃；时间非法时回退当前时间', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'empty', content: '' },
        { id: 'huge', content: 'x'.repeat(100_001) },
        { id: 'ok', content: 'echo hi', createdAt: 'bad', updatedAt: null },
      ]),
    )
    const list = loadHistory()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('ok')
    expect(list[0].createdAt).toBeGreaterThan(0)
  })

  it('按 updatedAt 降序且最多保留 30 条', () => {
    const list = Array.from({ length: 40 }, (_, i) =>
      entry({ id: `e${i}`, updatedAt: 1700000000000 + i }),
    )
    saveHistory(list)
    const loaded = loadHistory()
    expect(loaded).toHaveLength(30)
    expect(loaded[0].id).toBe('e39')
    expect(loaded[29].id).toBe('e10')
  })
})

describe('upsertHistory', () => {
  it('新条目置顶；同 id 更新去重；超限丢最旧', () => {
    const a = entry({ id: 'a', updatedAt: 1 })
    const b = entry({ id: 'b', updatedAt: 2 })
    const a2 = { ...a, updatedAt: 3 }
    expect(upsertHistory(upsertHistory([], a), b).map((e) => e.id)).toEqual(['b', 'a'])
    expect(upsertHistory(upsertHistory([], a), a2)).toHaveLength(1)

    let list: HistoryEntry[] = []
    for (let i = 0; i < 35; i++) {
      list = upsertHistory(list, entry({ id: `x${i}`, updatedAt: i }))
    }
    expect(list).toHaveLength(30)
    expect(list[0].id).toBe('x34')
    expect(list.map((e) => e.id)).not.toContain('x0')
  })
})

describe('saveHistory（容量不足降级）', () => {
  it('localStorage 写入失败时丢弃较旧条目重试，最终不抛错', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const list = [entry({ id: 'a' }), entry({ id: 'b' })]
    expect(() => saveHistory(list)).not.toThrow()
    setItem.mockRestore()

    // 恢复后重写：清空全部时移除存储键
    saveHistory([])
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
