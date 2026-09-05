/**
 * 片段（Snippet）存储：粘贴历史 v1 的演进版（plan-v2-accounts.md §4.3、§5.3）。
 *
 * 键策略（v2 兼容设计，与既有测试「一行不改地全绿」硬门槛对齐）：
 * - 匿名（未登录）路径沿用既有键 `vimpaste.history.v1`、上限 30 条——
 *   行为与 v1 完全一致，条目上允许携带新增的可选字段（kind/pinned/…）；
 * - 登录后的本地缓存用新键 `vimpaste.snippets.v2`、上限 500 条，
 *   并在登录时把 v1 既有条目迁移进来（v1 键保留一个版本的回滚窗口，不删）。
 * - `src/storage/history.ts`（v1 模块）原样保留：它描述旧形状且被旧测试覆盖，
 *   下一个版本随 v1 键一起清理。
 */

import type { HistoryEntry } from './history'
import { deriveTitle, createHistoryId } from './history'
import { isLangId } from '../detection/language'
import type { LangId } from '../detection/language'

export type SnippetKind = 'command' | 'prompt'

/** 同步状态：local=仅本地（或未登录）；pending=待推送；synced=与云端一致 */
export type SnippetSyncState = 'local' | 'pending' | 'synced'

export interface Snippet extends HistoryEntry {
  /** 旧数据一律视为 'command'（缺省时即 command） */
  kind?: SnippetKind
  pinned?: boolean
  /** 仅本地：永不离开浏览器（plan-v2-accounts.md §7.4） */
  localOnly?: boolean
  /** 云端集合 id；匿名条目恒为 undefined */
  collectionId?: number | null
  tags?: string[]
  /** 软删除墓碑（epoch ms）：云端路径删除的传播标记 */
  deletedAt?: number | null
  syncState?: SnippetSyncState
}

/** 匿名上限：沿用 v1 的 30 条（避免未登录用户撑爆 localStorage） */
export const MAX_LOCAL_SNIPPETS = 30
/** 登录用户本地缓存上限（plan-v2-accounts.md §5.3） */
export const MAX_CACHED_SNIPPETS = 500

/** 与 v1 一致的单条上限：单条内容超过时不保存 */
export const SNIPPET_MAX_CHARS = 100_000

export const LOCAL_STORAGE_KEY = 'vimpaste.history.v1'
export const CLOUD_CACHE_STORAGE_KEY = 'vimpaste.snippets.v2'

/** 白名单式清洗：未知字段一律丢弃，绝不透传（与 v1 sanitizeEntry 同一哲学） */
export function sanitizeSnippet(raw: unknown): Snippet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') return null
  if (typeof r.content !== 'string') return null
  if (r.content === '' || r.content.length > SNIPPET_MAX_CHARS) return null
  return {
    id: r.id,
    title: typeof r.title === 'string' && r.title !== '' ? r.title : deriveTitle(r.content),
    content: r.content,
    langId: isLangId(r.langId) ? (r.langId as LangId) : 'plaintext',
    createdAt: toTime(r.createdAt),
    updatedAt: toTime(r.updatedAt),
    kind: r.kind === 'prompt' ? 'prompt' : 'command',
    pinned: r.pinned === true,
    localOnly: r.localOnly === true,
    collectionId: typeof r.collectionId === 'number' ? r.collectionId : null,
    tags: sanitizeTags(r.tags),
    deletedAt: toTimeOrNull(r.deletedAt),
    syncState: r.syncState === 'pending' || r.syncState === 'synced' ? r.syncState : 'local',
  }
}

function toTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now()
}

function toTimeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()),
  )].slice(0, 20)
}

/** 存储后端描述：匿名与云端缓存只是键与上限不同 */
export interface SnippetStorageConfig {
  key: string
  maxEntries: number
}

export const LOCAL_SNIPPET_STORAGE: SnippetStorageConfig = {
  key: LOCAL_STORAGE_KEY,
  maxEntries: MAX_LOCAL_SNIPPETS,
}

export const CLOUD_CACHE_STORAGE: SnippetStorageConfig = {
  key: CLOUD_CACHE_STORAGE_KEY,
  maxEntries: MAX_CACHED_SNIPPETS,
}

function sortSnippets(list: Snippet[]): Snippet[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读 + 清洗 + 排序 + 截断；损坏数据静默降级为空列表（与 v1 行为一致） */
export function loadSnippetsFrom(config: SnippetStorageConfig): Snippet[] {
  try {
    const raw = localStorage.getItem(config.key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list = parsed.map(sanitizeSnippet).filter((s): s is Snippet => s !== null)
    return sortSnippets(list).slice(0, config.maxEntries)
  } catch {
    return []
  }
}

/** 覆盖式写入（含墓碑，供云端缓存持久化）；容量不足时从最旧开始丢弃重试 */
export function saveSnippetsTo(config: SnippetStorageConfig, entries: Snippet[]): void {
  let list = sortSnippets(entries.filter(
    (s) => s.content !== '' && s.content.length <= SNIPPET_MAX_CHARS,
  )).slice(0, config.maxEntries)
  while (list.length > 0) {
    try {
      localStorage.setItem(config.key, JSON.stringify(list))
      return
    } catch {
      list = list.slice(0, -1)
    }
  }
  try {
    localStorage.removeItem(config.key)
  } catch {
    /* 存储不可用时静默忽略 */
  }
}

/** 插入或更新（按 updatedAt 置顶）；截断交给 saveSnippetsTo */
export function upsertSnippet(entries: Snippet[], snippet: Snippet): Snippet[] {
  return sortSnippets([snippet, ...entries.filter((e) => e.id !== snippet.id)])
}

/**
 * 登录时的 v1 → v2 迁移（plan-v2-accounts.md §5.3）：
 * v1 键存在且 v2 键不存在时，读 v1 → 补默认字段 → 写 v2；v1 键保留不删（回滚窗口）。
 * 返回迁移后的条目列表（仅本地字段，kind 一律 'command'）。
 */
export function migrateV1ToV2(): Snippet[] {
  const hasV2 = localStorage.getItem(CLOUD_CACHE_STORAGE_KEY) !== null
  const v1Raw = localStorage.getItem(LOCAL_STORAGE_KEY)
  if (hasV2 || !v1Raw) return loadSnippetsFrom(CLOUD_CACHE_STORAGE)
  let migrated: Snippet[] = []
  try {
    const parsed: unknown = JSON.parse(v1Raw)
    if (Array.isArray(parsed)) {
      migrated = parsed
        .map(sanitizeSnippet)
        .filter((s): s is Snippet => s !== null)
        .map((s) => ({ ...s, syncState: 'local' as const }))
        .slice(0, MAX_CACHED_SNIPPETS)
    }
  } catch {
    migrated = []
  }
  saveSnippetsTo(CLOUD_CACHE_STORAGE, migrated)
  return loadSnippetsFrom(CLOUD_CACHE_STORAGE)
}

export { deriveTitle, createHistoryId }
