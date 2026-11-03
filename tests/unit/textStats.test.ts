import { describe, expect, it } from 'vitest'
import { splitLines } from '../../src/utils/textStats'

describe('splitLines（详情页行号）', () => {
  it('按换行切成逻辑行，行号从 1 开始', () => {
    expect(splitLines('a\nb\nc')).toEqual([
      { no: 1, text: 'a\n' },
      { no: 2, text: 'b\n' },
      { no: 3, text: 'c' },
    ])
  })

  it('单行内容只有一行，不带行尾换行', () => {
    expect(splitLines('curl -sfL https://get.k3s.io')).toEqual([
      { no: 1, text: 'curl -sfL https://get.k3s.io' },
    ])
  })

  it('尾随换行不额外算一行（编辑器语义），但保留在最后一行文本里', () => {
    expect(splitLines('a\n')).toEqual([{ no: 1, text: 'a\n' }])
    expect(splitLines('a\n\n')).toEqual([
      { no: 1, text: 'a\n' },
      { no: 2, text: '\n' },
    ])
  })

  it('空内容仍算一行（与编辑器一致）', () => {
    expect(splitLines('')).toEqual([{ no: 1, text: '' }])
    expect(splitLines('\n')).toEqual([{ no: 1, text: '\n' }])
  })

  it('各行的 text 拼回去与原文逐字一致（复制 / 全选 / 逐字断言的前提）', () => {
    const samples = [
      '',
      '\n',
      'a',
      'a\n',
      'a\n\n',
      'a\nb',
      '\n\n\n',
      '  --node-ip 10.10.0.12 \\\n  中文注释\n\ttabbed',
      'x'.repeat(1000),
    ]
    for (const content of samples) {
      expect(
        splitLines(content)
          .map((line) => line.text)
          .join(''),
      ).toBe(content)
    }
  })
})
