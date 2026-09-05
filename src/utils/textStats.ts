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

/** 粗略 token 估算：字符数 / 4（界面必须标注为估算值） */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}
