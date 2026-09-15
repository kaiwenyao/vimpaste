/**
 * 片段（Snippet）存储：粘贴历史 v1 的演进版（plan-v2-accounts.md §4.3、§5.3）。
 *
 * 键策略（v2 兼容设计，与既有测试「一行不改地全绿」硬门槛对齐）：
 * - 匿名（未登录）路径沿用既有键 `vimpaste.history.v1`、上限 30 条——
 *   行为与 v1 完全一致，条目上允许携带新增的可选字段（kind/pinned/…）；
 * - 登录后的本地缓存用新键 `vimpaste.snippets.v2.<userId>`（按用户隔离）、上限 500 条，
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
  /** 备注：这个片段是做什么的（可选元信息；留空视为无备注） */
  note?: string
  pinned?: boolean
  /** 仅本地：永不离开浏览器（plan-v2-accounts.md §7.4） */
  localOnly?: boolean
  /** 云端收藏夹 id；匿名条目恒为 undefined */
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

/**
 * 回收站保留天数。与服务端 TOMBSTONE_RETENTION_DAYS 的默认值一致：
 * 两条路径（未登录 / 登录）对用户必须是同一个承诺——「删了还能找回 30 天」。
 */
export const TRASH_RETENTION_DAYS = 30
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
/**
 * 匿名路径的回收站上限。与 active 的 30 条**分开计算**：
 * 若共用同一个额度，删满 30 条会把仍在用的条目挤出存储——「删除」变成「清空整个库」。
 */
export const MAX_LOCAL_TRASH_SNIPPETS = 30
/** 登录用户本地缓存里的回收站上限（云端墓碑的本地镜像） */
export const MAX_CACHED_TRASH_SNIPPETS = 200

/** 与 v1 一致的单条上限：单条内容超过时不保存 */
export const SNIPPET_MAX_CHARS = 100_000

/** 标题上限：与服务端 schema（title ≤ 200）对齐 */
export const SNIPPET_TITLE_MAX_CHARS = 200
/** 备注上限：与服务端 schema 对齐 */
export const SNIPPET_NOTE_MAX_CHARS = 2000

export const LOCAL_STORAGE_KEY = 'vimpaste.history.v1'
/** 登录用户的本地缓存键前缀：按用户隔离——同一浏览器先后登录不同账号时，
 * 缓存、同步队列互不可见，A 的待推内容绝不会被推进 B 的账号 */
export const CLOUD_CACHE_STORAGE_PREFIX = 'vimpaste.snippets.v2'

/** 白名单式清洗：未知字段一律丢弃，绝不透传（与 v1 sanitizeEntry 同一哲学） */
export function sanitizeSnippet(raw: unknown): Snippet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') return null
  if (typeof r.content !== 'string') return null
  if (r.content === '' || r.content.length > SNIPPET_MAX_CHARS) return null
  const note = sanitizeNote(r.note)
  return {
    id: r.id,
    title:
      typeof r.title === 'string' && r.title !== ''
        ? r.title.trim().slice(0, SNIPPET_TITLE_MAX_CHARS) || deriveTitle(r.content)
        : deriveTitle(r.content),
    content: r.content,
    ...(note !== undefined ? { note } : {}),
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

/** 标签上限：与服务端 schema（≤ 20 个、单个 ≤ 64 字符）对齐 */
export const MAX_TAGS_PER_SNIPPET = 20
export const MAX_TAG_CHARS = 64

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim().slice(0, MAX_TAG_CHARS)),
    ),
  ].slice(0, MAX_TAGS_PER_SNIPPET)
}

/** 备注清洗：非字符串丢弃，空白折叠为无备注，超长截断 */
function sanitizeNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, SNIPPET_NOTE_MAX_CHARS).trim()
  return trimmed === '' ? undefined : trimmed
}

/** 存储后端描述：匿名与云端缓存只是键与上限不同 */
export interface SnippetStorageConfig {
  key: string
  maxEntries: number
  /** 回收站墓碑上限：与 maxEntries 分开计算，墓碑绝不占用 active 名额 */
  maxTrashEntries: number
}

export const LOCAL_SNIPPET_STORAGE: SnippetStorageConfig = {
  key: LOCAL_STORAGE_KEY,
  maxEntries: MAX_LOCAL_SNIPPETS,
  maxTrashEntries: MAX_LOCAL_TRASH_SNIPPETS,
}

/** 登录用户的本地缓存存储：键按 user.id 隔离 */
export function cloudCacheStorage(userId: number): SnippetStorageConfig {
  return {
    key: `${CLOUD_CACHE_STORAGE_PREFIX}.${userId}`,
    maxEntries: MAX_CACHED_SNIPPETS,
    maxTrashEntries: MAX_CACHED_TRASH_SNIPPETS,
  }
}

function sortSnippets(list: Snippet[]): Snippet[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 回收站排序：按删除时间倒序（最近删的在最上面），与列表展示一致 */
function sortTrash(list: Snippet[]): Snippet[] {
  return [...list].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

/** 是否为回收站里的墓碑条目 */
export function isTrashed(snippet: Snippet): boolean {
  return snippet.deletedAt != null
}

/** 墓碑是否已到期（保留期满即彻底清除） */
export function isTrashExpired(snippet: Snippet, now = Date.now()): boolean {
  return snippet.deletedAt != null && now - snippet.deletedAt >= TRASH_RETENTION_MS
}

/**
 * 清掉已到期的墓碑。本地路径没有定时任务，靠「打开应用 / 读存储」时惰性执行；
 * 云端路径的服务端另有每日硬删任务，这里只清理本地缓存镜像。
 */
export function purgeExpiredTombstones(entries: Snippet[], now = Date.now()): Snippet[] {
  return entries.filter((s) => !isTrashExpired(s, now))
}

/**
 * 回收站里的剩余天数（0 = 今天到期）；负数/非法值按 0 处理。
 * retentionDays 默认取客户端常量，云端传入服务端回传的实际配置（自托管可改）。
 */
export function trashDaysLeft(
  deletedAt: number,
  now = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS,
): number {
  const remaining = retentionDays * 24 * 60 * 60 * 1000 - (now - deletedAt)
  return remaining <= 0 ? 0 : Math.ceil(remaining / (24 * 60 * 60 * 1000))
}

/** active / 回收站分桶：各自独立限额，并顺带清掉到期墓碑 */
export function splitByTrash(
  entries: Snippet[],
  config: Pick<SnippetStorageConfig, 'maxEntries' | 'maxTrashEntries'>,
  now = Date.now(),
): { active: Snippet[]; trash: Snippet[] } {
  const fresh = purgeExpiredTombstones(entries, now)
  return {
    active: sortSnippets(fresh.filter((s) => !isTrashed(s))).slice(0, config.maxEntries),
    trash: sortTrash(fresh.filter(isTrashed)).slice(0, config.maxTrashEntries),
  }
}

/** 回收站里的墓碑（供 UI 展示；顺序按删除时间倒序） */
export function trashedSnippets(entries: Snippet[], now = Date.now()): Snippet[] {
  return sortTrash(purgeExpiredTombstones(entries, now).filter(isTrashed))
}

/** 读 + 清洗 + 排序 + 截断；损坏数据静默降级为空列表（与 v1 行为一致） */
export function loadSnippetsFrom(config: SnippetStorageConfig): Snippet[] {
  try {
    const raw = localStorage.getItem(config.key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list = parsed.map(sanitizeSnippet).filter((s): s is Snippet => s !== null)
    // 到期墓碑在读取时顺带清除：用户下次打开应用就看不到它们了
    const { active, trash } = splitByTrash(list, config)
    return [...active, ...trash]
  } catch {
    return []
  }
}

/** 覆盖式写入（含墓碑，供云端缓存持久化）；容量不足时从最旧开始丢弃重试 */
export function saveSnippetsTo(config: SnippetStorageConfig, entries: Snippet[]): void {
  const { active, trash } = splitByTrash(
    entries.filter((s) => s.content !== '' && s.content.length <= SNIPPET_MAX_CHARS),
    config,
  )
  let list = [...active, ...trash]
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
 * 删除进回收站：只写墓碑，内容原样保留（绝不丢字），updatedAt 不动——
 * 墓碑的「时间」是 deletedAt，改 updatedAt 会让服务端同步把它当成一次内容更新。
 */
export function markTrashed(entries: Snippet[], id: string, now = Date.now()): Snippet[] {
  return entries.map((s) => (s.id === id && s.deletedAt == null ? { ...s, deletedAt: now } : s))
}

/**
 * 从回收站恢复：清墓碑并把 updatedAt 推到当前时刻——
 * 恢复后的条目回到片段库列表顶部（用户刚做的事就该在最上面）。
 */
export function markRestored(entries: Snippet[], id: string, now = Date.now()): Snippet[] {
  return sortSnippets(
    entries.map((s) => (s.id === id ? { ...s, deletedAt: null, updatedAt: now } : s)),
  )
}

/** 彻底删除：从列表里移除（回收站的单条清除 / 清空 / 到期清理共用） */
export function dropSnippets(entries: Snippet[], ids: readonly string[]): Snippet[] {
  const drop = new Set(ids)
  return entries.filter((s) => !drop.has(s.id))
}

/**
 * 存储里实际落盘的条目数（读不出来时返回 null）。
 * 用于判断启动时的清理结果是否需要写回：到期墓碑被 loadSnippetsFrom 过滤掉后
 * 如果不写回，过期数据会一直占着 localStorage 额度。
 */
export function storedEntryCount(config: SnippetStorageConfig): number | null {
  try {
    const raw = localStorage.getItem(config.key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

/**
 * 登录时的 v1 → v2 迁移（plan-v2-accounts.md §5.3）：
 * 该用户专属的 v2 键不存在且 v1 键存在时，读 v1 → 补默认字段 → 写 v2；
 * v1 键保留不删（回滚窗口）。返回迁移后的条目列表（仅本地字段，kind 一律 'command'）。
 */
export function migrateV1ToV2(userId: number): Snippet[] {
  const storage = cloudCacheStorage(userId)
  const hasV2 = localStorage.getItem(storage.key) !== null
  const v1Raw = localStorage.getItem(LOCAL_STORAGE_KEY)
  if (hasV2 || !v1Raw) return loadSnippetsFrom(storage)
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
  saveSnippetsTo(storage, migrated)
  return loadSnippetsFrom(storage)
}

export { deriveTitle, createHistoryId }
