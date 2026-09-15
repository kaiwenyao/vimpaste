/**
 * 回收站视图的纯逻辑：把两种真相来源合并成一份可直接渲染的条目列表。
 *
 * - 未登录：墓碑就在 localStorage（store 快照里 deletedAt != null 的条目）；
 * - 已登录：服务端墓碑是权威（GET /api/snippets/trash），但还要并上「本地尚未送达
 *   服务端」的墓碑——离线新建后立刻就删的条目服务端根本不知道，只显示服务端列表
 *   会让用户看到「我明明删了，回收站里却没有」。
 *
 * 这些函数不碰 DOM 也不发请求，App / 页面 / 单测共用同一份规则。
 */
import type { ApiSnippet } from '../cloud/api'
import type { Snippet } from '../storage/snippets'
import { TRASH_RETENTION_DAYS, trashDaysLeft } from '../storage/snippets'

export interface TrashEntry {
  id: string
  title: string
  note?: string
  content: string
  langId: string
  /** 删除时刻（epoch ms）：云端条目用服务端写入的时间 */
  deletedAt: number
  /** 服务端还不知道这条（未登录，或删除尚未送达）：操作只需处理本地 */
  pending: boolean
}

/** 本地墓碑 → 展示条目；不是墓碑时返回 null（调用方用 filter 收口） */
export function trashEntryFromLocal(snippet: Snippet): TrashEntry | null {
  if (snippet.deletedAt == null) return null
  return {
    id: snippet.id,
    title: snippet.title,
    ...(snippet.note ? { note: snippet.note } : {}),
    content: snippet.content,
    langId: snippet.langId,
    deletedAt: snippet.deletedAt,
    pending: true,
  }
}

/** 服务端墓碑 → 展示条目；deletedAt 为空视为异常数据，不展示 */
export function trashEntryFromServer(snippet: ApiSnippet): TrashEntry | null {
  if (snippet.deletedAt == null) return null
  return {
    id: snippet.id,
    title: snippet.title,
    ...(snippet.note ? { note: snippet.note } : {}),
    content: snippet.content,
    langId: snippet.langId,
    deletedAt: snippet.deletedAt,
    pending: false,
  }
}

/**
 * 合并并按删除时间倒序（最近删的在最上面）。
 * 同一条目以服务端版本为准：服务端时间才是「保留 30 天」的依据，
 * 本地时钟偏一点就会把剩余天数算错。
 *
 * localOnlyAliveIds = 本机仍存活且标为「仅本地」的条目 id。这些条目在服务端的墓碑
 * 只是「把其它设备的副本删掉」的同步信号，本机并没有删它——不过滤掉的话，
 * 用户会在回收站里看到一条明明还在片段库里的条目。
 */
export function mergeTrashEntries(
  local: Snippet[],
  server: ApiSnippet[] | null,
  localOnlyAliveIds: ReadonlySet<string> = new Set<string>(),
): TrashEntry[] {
  const fromServer = (server ?? [])
    .map(trashEntryFromServer)
    .filter((e): e is TrashEntry => e !== null)
    .filter((e) => !localOnlyAliveIds.has(e.id))
  const known = new Set(fromServer.map((e) => e.id))
  const localOnly = local
    .map(trashEntryFromLocal)
    .filter((e): e is TrashEntry => e !== null)
    .filter((e) => !known.has(e.id))
  return [...fromServer, ...localOnly].sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 列表里还能放几天文案：0 天说「今天到期」比「剩余 0 天」自然 */
export function formatDaysLeft(
  deletedAt: number,
  retentionDays = TRASH_RETENTION_DAYS,
  now = Date.now(),
): string {
  const days = trashDaysLeft(deletedAt, now, retentionDays)
  return days <= 0 ? '今天到期' : `剩余 ${days} 天`
}

export interface TrashListState {
  entries: TrashEntry[]
  /** 保留天数：云端取服务端配置，未登录用默认值 */
  retentionDays: number
}

/** 未登录（或云端尚未拉取）时的回收站视图：全部来自本地墓碑 */
export function localTrashList(
  local: Snippet[],
  retentionDays = TRASH_RETENTION_DAYS,
): TrashListState {
  return { entries: mergeTrashEntries(local, null), retentionDays }
}
