/**
 * 占位符识别：只做识别、装饰与导航，绝不自动替换。
 *
 * 识别顺序即优先级（单个正则从左到右、位置优先），
 * 保证 `${YOUR_TOKEN}` 这类嵌套写法只标记一次：
 *  1. `${TOKEN}` / `${PASSWORD}` —— 大括号形式
 *  2. `<TOKEN>` / `<IP_ADDRESS>` —— 尖括号形式
 *  3. `$YOUR_TOKEN` —— $ 前缀形式
 *  4. `YOUR_TOKEN` / `REPLACE_ME` / `CHANGE_ME` / `*_HERE` —— 裸词
 *  5. 环境变量赋值的占位值：`export API_KEY="你的 API Key"`、`TOKEN=sk-xxx`、
 *     `DEEPSEEK_API_KEY=""`（空值仅限 KEY/TOKEN/SECRET 类变量名）——标记值本身，
 *     跳转选中后直接输入真实值即可。与规则 1–4 重叠的候选丢弃，先识别的优先。
 * 引号中的占位符（如 'YOUR_TOKEN'）由上述规则自然覆盖。
 *
 * 允许误判：识别结果只用于提示与跳转，不影响编辑与复制。
 */

export type PlaceholderKind = 'brace' | 'angle' | 'dollar' | 'word' | 'env'

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

/**
 * 环境变量赋值：行首或空白/;/&/| 之后的 `export VAR=…` 或 `VAR=…`（变量名大写）。
 * d 标志提供捕获组偏移，用于只标记值本身；引号值标引号内的内容，
 * 与 `'YOUR_TOKEN'` 只标内部文本的行为一致。
 */
const ENV_ASSIGNMENT_RE =
  /(?:^|[\s;&|])(export[ \t]+)?([A-Z][A-Z0-9_]{1,})=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s;&|]+))/dg

/** 值里出现 CJK（中日韩文字）即视为占位：AI 生成的中文说明常写「你的 API Key」「在此填入」 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** 值里出现这些词（不区分大小写的子串）即视为占位 */
const PLACEHOLDER_VALUE_WORDS = [
  'your',
  'xxx',
  'placeholder',
  'dummy',
  'changeme',
  'change_me',
  'replace',
]

/** 值为空串（"" / ''）时，只有这类“密钥感”变量名才值得提示填入 */
const SECRET_NAME_RE = /(?:API|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|CERT)/

function valueLooksPlaceholder(value: string): boolean {
  if (CJK_RE.test(value)) return true
  if (value.includes('...') || value.includes('…')) return true
  const low = value.toLowerCase()
  return PLACEHOLDER_VALUE_WORDS.some((w) => low.includes(w))
}

function overlapsAny(matches: PlaceholderMatch[], start: number, end: number): boolean {
  return matches.some((m) => start < m.end && m.start < end)
}

/** 环境变量赋值中占位值的识别；候选追加进 matches（同时用于重叠去重） */
function collectEnvPlaceholders(text: string, matches: PlaceholderMatch[]): void {
  for (const m of text.matchAll(ENV_ASSIGNMENT_RE)) {
    const idx = m.indices
    if (!idx) continue
    const name = m[2] ?? ''
    let candidate: { start: number; end: number }
    if (m[3] !== undefined || m[4] !== undefined) {
      const inner = m[3] ?? m[4] ?? ''
      const innerRange = idx[3] ?? idx[4]
      if (!innerRange) continue
      if (inner === '') {
        // 空值没有内容可选，连引号一起标记；普通变量留空是常态，只提示密钥类
        if (!SECRET_NAME_RE.test(name)) continue
        candidate = { start: innerRange[0] - 1, end: innerRange[1] + 1 }
      } else {
        if (!valueLooksPlaceholder(inner)) continue
        candidate = { start: innerRange[0], end: innerRange[1] }
      }
    } else {
      const bare = m[5] ?? ''
      const bareRange = idx[5]
      if (!bareRange || !bare) continue
      if (bare.startsWith('$')) continue // $OTHER_VAR 是取值引用，不是占位
      if (!valueLooksPlaceholder(bare)) continue
      candidate = { start: bareRange[0], end: bareRange[1] }
    }
    if (!overlapsAny(matches, candidate.start, candidate.end)) {
      matches.push({
        start: candidate.start,
        end: candidate.end,
        text: text.slice(candidate.start, candidate.end),
        kind: 'env',
      })
    }
  }
}

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
  collectEnvPlaceholders(text, matches)
  matches.sort((a, b) => a.start - b.start)
  return matches
}
