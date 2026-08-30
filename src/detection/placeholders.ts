/**
 * 占位符识别：只做识别、装饰与导航，绝不自动替换。
 *
 * 识别顺序即优先级（单个正则从左到右、位置优先），
 * 保证 `${YOUR_TOKEN}` 这类嵌套写法只标记一次：
 *  1. `${TOKEN}` / `${PASSWORD}` —— 大括号形式
 *  2. `<TOKEN>` / `<IP_ADDRESS>` —— 尖括号形式
 *  3. `$YOUR_TOKEN` —— $ 前缀形式
 *  4. `YOUR_TOKEN` / `REPLACE_ME` / `CHANGE_ME` / `*_HERE` —— 裸词
 * 引号中的占位符（如 'YOUR_TOKEN'）由上述规则自然覆盖。
 *
 * 允许误判：识别结果只用于提示与跳转，不影响编辑与复制。
 */

export type PlaceholderKind = 'brace' | 'angle' | 'dollar' | 'word'

export interface PlaceholderMatch {
  /** 起始偏移（含），基于整段文本的 0-based 索引 */
  start: number
  /** 结束偏移（不含） */
  end: number
  text: string
  kind: PlaceholderKind
}

const PLACEHOLDER_SOURCE = [
  String.raw`\$\{[A-Z][A-Z0-9_]{1,}\}`, // ${TOKEN} ${PASSWORD}
  String.raw`<\$?[A-Z][A-Z0-9_]{1,}>`, // <TOKEN> <IP_ADDRESS> <$HOST>
  String.raw`\$YOUR_[A-Z0-9_]+`, // $YOUR_TOKEN
  String.raw`\b(?:YOUR_[A-Z0-9_]+|REPLACE_ME|CHANGE_ME|[A-Z][A-Z0-9_]*_HERE)\b`, // YOUR_TOKEN REPLACE_ME …
].join('|')

const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_SOURCE, 'g')

/** 超过该长度的文本不再扫描，避免极端输入卡顿 */
export const MAX_SCAN_LENGTH = 200_000

export function findPlaceholders(text: string): PlaceholderMatch[] {
  if (!text || text.length > MAX_SCAN_LENGTH) return []
  const matches: PlaceholderMatch[] = []
  PLACEHOLDER_RE.lastIndex = 0
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const full = m[0]
    const kind: PlaceholderKind = full.startsWith('${')
      ? 'brace'
      : full.startsWith('<')
        ? 'angle'
        : full.startsWith('$')
          ? 'dollar'
          : 'word'
    matches.push({ start: m.index, end: m.index + full.length, text: full, kind })
  }
  return matches
}
