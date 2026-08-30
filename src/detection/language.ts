/**
 * 语言识别：两层策略。
 *
 * 1. 场景优先规则（heuristicDetect，同步）：Shebang、`sh -s -`、管道进 sh、
 *    续行反斜杠、常见命令、环境变量赋值等强特征优先判为 Shell；
 *    其余语言按明确特征直接识别（Dockerfile / PowerShell / Python / SQL / Nginx / YAML / JSON）。
 * 2. 通用检测（detectLanguage，异步）：highlight.js 的 highlightAuto，
 *    在受限候选语言内评分；得分过低时回落到纯文本。
 *
 * 识别永远可能误判，因此 UI 必须展示当前语言并允许手动覆盖。
 */

export type LangId =
  | 'shell'
  | 'powershell'
  | 'yaml'
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'sql'
  | 'dockerfile'
  | 'nginx'
  | 'plaintext'

export interface LanguageInfo {
  id: LangId
  /** 界面显示名 */
  label: string
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'shell', label: 'Shell / Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'yaml', label: 'YAML' },
  { id: 'json', label: 'JSON' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'SQL' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'plaintext', label: '纯文本' },
]

export function languageLabel(id: LangId): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? '纯文本'
}

const SHELL_COMMANDS =
  /\b(?:curl|wget|sudo|apt|apt-get|yum|dnf|brew|git|docker|kubectl|helm|systemctl|service|journalctl|ssh|scp|rsync|tar|gzip|gunzip|chmod|chown|export|source|cd|ls|cp|mv|rm|mkdir|touch|cat|echo|grep|sed|awk|find|xargs|env|printenv|alias|which|ping|ifconfig|ip|netstat|nc|df|du|ps|kill|head|tail|less|nano|bash|sh|zsh|make|cargo|npm|pnpm|yarn|pip3?|python3?|uname|reboot|mount|swapon)\b/

/** Shell 特征强度评分。达到 SHELL_THRESHOLD 判为 Shell。 */
export function shellScore(text: string): number {
  const t = text.slice(0, 4000)
  let score = 0
  if (/^\s*#!.*\b(?:bash|sh|zsh|dash|ksh)\b/m.test(t)) score += 10
  if (/\b(?:ba|z|da)?sh\s+-[a-zA-Z]*s[a-zA-Z]*\s+(?:-|--)\b/.test(t)) score += 5 // sh -s -
  if (/\b(?:ba|z)?sh\s+-[a-zA-Z]*c\b/.test(t)) score += 5 // bash -c
  if (/\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(t)) score += 4 // 管道进 sh
  if (/\\\s*\n/.test(t)) score += 2 // 续行反斜杠
  score += Math.min(2, t.match(/\|/g)?.length ?? 0) // 管道
  score += Math.min(2, t.match(/&&|\|\|/g)?.length ?? 0) // 命令连接
  score += Math.min(
    2,
    t.match(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)/gm)?.length ?? 0,
  ) // 变量赋值
  if (/\b(?:sudo|export)\b/.test(t)) score += 2
  if (SHELL_COMMANDS.test(t)) score += 3
  const flagCount = t.match(/(?:^|[\s=])--?[a-zA-Z][\w-]*/g)?.length ?? 0
  if (flagCount >= 2) score += 2
  else if (flagCount === 1) score += 1
  return score
}

const SHELL_THRESHOLD = 8

/** 同步启发式识别：强特征直接判定，弱特征交给 highlight.js */
export function heuristicDetect(text: string): LangId | null {
  if (!text.trim()) return 'plaintext'
  const t = text.slice(0, 4000)

  // Shell：最高优先级（本产品主场景）
  if (shellScore(t) >= SHELL_THRESHOLD) return 'shell'

  // Dockerfile：FROM 指令 + 其他典型指令
  if (
    /\bFROM\s+\S+/m.test(t) &&
    t.match(/^\s*(?:RUN|CMD|COPY|ADD|WORKDIR|EXPOSE|ENV|ENTRYPOINT|ARG|LABEL|VOLUME|USER)\b/m)
      ?.length
  ) {
    return 'dockerfile'
  }

  if (shellScore(t) >= SHELL_THRESHOLD - 2) return 'shell' // 次强 Shell 特征

  // JSON：整体可解析
  if (/^\s*[[{]/.test(t)) {
    try {
      JSON.parse(text.slice(0, 10_000))
      return 'json'
    } catch {
      /* 不是合法 JSON，继续 */
    }
  }

  // PowerShell：Cmdlet 命名特征
  if (
    /\b(?:Get|Set|New|Remove|Invoke|Test|Copy|Write|Start|Stop|Install|Update)-[A-Z]\w+\b/.test(t)
  ) {
    return 'powershell'
  }

  // Python
  if (
    /^\s*(?:import\s+\w+|from\s+\w+(?:\.\w+)*\s+import\b|def\s+\w+\s*\(|class\s+\w+[:(]|print\s*\()/m.test(
      t,
    )
  ) {
    return 'python'
  }

  // SQL：关键字组合，避免单个 FROM 误判
  if (
    /\b(?:SELECT\s+[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW))\b/i.test(
      t,
    )
  ) {
    return 'sql'
  }

  // Nginx：server/location/http 块 + listen 指令
  if (/\b(?:server|location|http|upstream|events)\s*\{/m.test(t) && /\blisten\s+\S+/m.test(t)) {
    return 'nginx'
  }

  // YAML：文档标记或多行 key: value
  const yamlKeys = t.match(/^[ \t]*[\w.-]+:(?:\s|$)/gm)?.length ?? 0
  if (/^\s*---\s*$/m.test(t) || yamlKeys >= 2) return 'yaml'

  return null
}

// ---------------------------------------------------------------------------
// highlight.js 受限候选检测（语言包按需动态加载）
// ---------------------------------------------------------------------------

import type hljsCore from 'highlight.js/lib/core'

type HLJS = typeof hljsCore

const HLJS_LANGUAGES = [
  'bash',
  'powershell',
  'yaml',
  'json',
  'javascript',
  'typescript',
  'python',
  'sql',
  'dockerfile',
  'nginx',
] as const

const HLJS_TO_LANG: Record<string, LangId> = {
  bash: 'shell',
  powershell: 'powershell',
  yaml: 'yaml',
  json: 'json',
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  sql: 'sql',
  dockerfile: 'dockerfile',
  nginx: 'nginx',
}

let hljsPromise: Promise<HLJS> | null = null

async function loadHljs(): Promise<HLJS> {
  const hljs = (await import('highlight.js/lib/core')).default
  await Promise.all(
    HLJS_LANGUAGES.map(async (name) => {
      const mod = await import(`highlight.js/lib/languages/${name}.js`)
      hljs.registerLanguage(name, mod.default)
    }),
  )
  return hljs
}

function getHljs(): Promise<HLJS> {
  hljsPromise ??= loadHljs()
  return hljsPromise
}

/** 总检测入口：先启发式，再 highlight.js 受限候选，最后回落纯文本 */
export async function detectLanguage(text: string): Promise<LangId> {
  const heuristic = heuristicDetect(text)
  if (heuristic) return heuristic
  if (!text.trim()) return 'plaintext'
  try {
    const hljs = await getHljs()
    // 只取有限长度参与评分，避免影响输入
    const sample = text.slice(0, 4000)
    const result = hljs.highlightAuto(sample, [...HLJS_LANGUAGES])
    if (result.language && result.relevance >= 3) {
      return HLJS_TO_LANG[result.language] ?? 'plaintext'
    }
  } catch {
    /* 检测失败时静默回落 */
  }
  return 'plaintext'
}
