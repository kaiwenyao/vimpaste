/**
 * 客户端时间戳的合理性钳制（plan-v2-accounts.md §5.1）：
 * 时间戳由客户端提供才能表达离线修改，但未来时间与「1970 纪元值」不合理，
 * 钳制到服务器当前时间——只修正不合理值，不改变正常值。
 */

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
/** 早于 1990-01-01 的时间视为无效（涵盖 1970 纪元值） */
const ANCIENT_BOUNDARY_MS = Date.UTC(1990, 0, 1)

export function clampTimestamp(value: number, now = Date.now()): number {
  if (!Number.isFinite(value)) return now
  if (value > now + FUTURE_TOLERANCE_MS) return now
  if (value < ANCIENT_BOUNDARY_MS) return now
  return Math.round(value)
}

/** 同步时逐条钳制 createdAt/updatedAt/lastUsedAt，避免污染服务端排序 */
export function clampSnippetTimestamps<
  T extends { createdAt: number; updatedAt: number; lastUsedAt: number | null },
>(snippet: T, now = Date.now()): T {
  return {
    ...snippet,
    createdAt: clampTimestamp(snippet.createdAt, now),
    updatedAt: clampTimestamp(snippet.updatedAt, now),
    lastUsedAt: snippet.lastUsedAt === null ? null : clampTimestamp(snippet.lastUsedAt, now),
  }
}
