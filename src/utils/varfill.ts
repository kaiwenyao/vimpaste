/**
 * 变量填充（plan-v2-accounts.md §8 Phase 6）：
 * 解析 {{变量}} 生成表单，填充后只影响复制出去的内容，原文不被修改。
 * 每个变量上次填的值记在 localStorage（键 vimpaste.varfill.v1，按条目隔离）——
 * 这是「仅本地」语义的数据，永不进入同步队列。
 */
import { parsePromptVariables } from '../detection/placeholders'
import { fillPromptTemplate } from '../detection/placeholders'

const VARFILL_KEY = 'vimpaste.varfill.v1'

export interface VarFillMemory {
  [snippetId: string]: Record<string, string>
}

function loadMemory(): VarFillMemory {
  try {
    const raw = localStorage.getItem(VARFILL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VarFillMemory
    if (typeof parsed !== 'object' || parsed === null) return {}
    // 白名单清洗：只保留 string → string 两层结构
    const out: VarFillMemory = {}
    for (const [snippetId, values] of Object.entries(parsed)) {
      if (typeof values !== 'object' || values === null) continue
      const clean: Record<string, string> = {}
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string') clean[name] = value
      }
      out[snippetId] = clean
    }
    return out
  } catch {
    return {}
  }
}

export function rememberVarValues(snippetId: string, values: Record<string, string>): void {
  const memory = loadMemory()
  const nonEmpty = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== ''),
  )
  if (Object.keys(nonEmpty).length === 0) delete memory[snippetId]
  else memory[snippetId] = nonEmpty
  try {
    localStorage.setItem(VARFILL_KEY, JSON.stringify(memory))
  } catch {
    /* 存储不可用时静默忽略 */
  }
}

/** 上次填过的值（当前条目）；无记录的变量返回空串 */
export function lastVarValues(snippetId: string, names: string[]): Record<string, string> {
  const memory = loadMemory()
  const saved = memory[snippetId] ?? {}
  return Object.fromEntries(names.map((name) => [name, saved[name] ?? '']))
}

/** 上次值回填后仍有变量为空 → 表单不算完成 */
export function missingVars(names: string[], values: Record<string, string>): string[] {
  return names.filter((n) => (values[n] ?? '').trim() === '')
}

export { parsePromptVariables, fillPromptTemplate }
