/**
 * Prompt 字数与 token 估算（plan-v2-accounts.md §8）：
 * CJK 字符逐字计数，连续的拉丁词计 1 词；token 数用「字符数 / 4」粗估并标注为估算。
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

export function countWords(text: string): number {
  let count = 0
  let inLatinWord = false
  for (const ch of text) {
    if (/\s/.test(ch)) {
      inLatinWord = false
      continue
    }
    if (CJK_RE.test(ch)) {
      count += 1
      inLatinWord = false
    } else {
      if (!inLatinWord) count += 1
      inLatinWord = true
    }
  }
  return count
}

export interface ContentLine {
  /** 行号，从 1 开始（与编辑器行号一致） */
  no: number
  /** 该行文本。含行尾换行；尾随换行挂在最后一行上，因此拼回去可逐字还原原文 */
  text: string
}

/**
 * 把全文切成逻辑行。尾随换行不额外算一行（编辑器里 `"a\\n"` 就是 1 行），
 * 但会留在最后一行文本里，所以 `splitLines(c).map((l) => l.text).join('') === c` 恒成立——
 * 详情页的复制 / 全选 / 逐字断言都靠这个性质。
 */
export function splitLines(content: string): ContentLine[] {
  const parts = content.split('\n')
  const trailingBreak = parts.length > 1 && parts[parts.length - 1] === ''
  const texts = trailingBreak ? parts.slice(0, -1) : parts
  const last = texts.length - 1
  return texts.map((text, i) => ({
    no: i + 1,
    text: i === last && !trailingBreak ? text : `${text}\n`,
  }))
}

/** 粗略 token 估算：字符数 / 4（界面必须标注为估算值） */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}
