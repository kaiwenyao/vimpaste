/**
 * 粘贴历史存储：写入浏览器 localStorage（键 vimpaste.history.v1），不上传任何数据。
 * 这是用户显式可关闭的功能（历史面板中一键关闭并清空，见 prefs.historyEnabled）。
 * 上限：最近 MAX_HISTORY_ENTRIES 条；单条内容超过 MAX_ENTRY_CHARS 字符时不保存该条，
 * 容量不足（QuotaExceeded）时从最旧开始丢弃重试。
 */

import { isLangId } from '../detection/language'
import type { LangId } from '../detection/language'

export interface HistoryEntry {
  id: string
  title: string
  content: string
  langId: LangId
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'vimpaste.history.v1'

export const MAX_HISTORY_ENTRIES = 30
export const MAX_ENTRY_CHARS = 100_000
export const TITLE_MAX_CHARS = 48

/** 标题取第一条非空行：压缩空白、截断；用于历史列表的条目名 */
export function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim() !== '') ?? ''
  const collapsed = firstLine.trim().replace(/\s+/g, ' ')
  if (!collapsed) return '（空）'
  return collapsed.length > TITLE_MAX_CHARS ? `${collapsed.slice(0, TITLE_MAX_CHARS)}…` : collapsed
}

export function createHistoryId(): string {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now()
}

/** 白名单式清洗：任何字段不合法的条目直接丢弃，绝不透传未知字段 */
function sanitizeEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') return null
  if (typeof r.content !== 'string') return null
  if (r.content === '' || r.content.length > MAX_ENTRY_CHARS) return null
  const createdAt = toTime(r.createdAt)
  return {
    id: r.id,
    title: typeof r.title === 'string' && r.title !== '' ? r.title : deriveTitle(r.content),
    content: r.content,
    langId: isLangId(r.langId) ? r.langId : 'plaintext',
    createdAt,
    updatedAt: toTime(r.updatedAt),
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list = parsed.map(sanitizeEntry).filter((entry): entry is HistoryEntry => entry !== null)
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list.slice(0, MAX_HISTORY_ENTRIES)
  } catch {
    return []
  }
}

/** 插入或更新一条（按 updatedAt 置顶），超出上限时丢弃最旧的 */
export function upsertHistory(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...entries.filter((e) => e.id !== entry.id)]
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  return next.slice(0, MAX_HISTORY_ENTRIES)
}

export function saveHistory(entries: HistoryEntry[]): void {
  let list = entries
    .filter((e) => e.content !== '' && e.content.length <= MAX_ENTRY_CHARS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY_ENTRIES)
  while (list.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      return
    } catch {
      // 容量不足：从最旧开始逐条丢弃重试，尽可能多保留
      list = list.slice(0, -1)
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 存储不可用时静默忽略 */
  }
}
