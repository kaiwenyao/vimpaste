/** 相对时间与历史分组：仅用于粘贴历史列表的展示。 */

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 10 * SEC) return '刚刚'
  if (diff < MIN) return `${Math.floor(diff / SEC)} 秒前`
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  const d = new Date(ts)
  const sameYear = new Date(now).getFullYear() === d.getFullYear()
  const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return sameYear ? date : `${d.getFullYear()} 年 ${date}`
}

/** 对话式历史列表的分组：今天 / 昨天 / 7 天内 / 30 天内 / 更早 */
export function historyGroupLabel(ts: number, now = Date.now()): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const t0 = startOfToday.getTime()
  if (ts >= t0) return '今天'
  if (ts >= t0 - DAY) return '昨天'
  if (ts >= t0 - 7 * DAY) return '7 天内'
  if (ts >= t0 - 30 * DAY) return '30 天内'
  return '更早'
}

/** 分组标题的英文副标：中文标题本身是稳定的可访问文本，英文只作装饰 */
export const HISTORY_GROUP_EN: Record<string, string> = {
  今天: 'Today',
  昨天: 'Yesterday',
  '7 天内': 'This week',
  '30 天内': 'This month',
  更早: 'Earlier',
}

/**
 * 按时间分组（片段库按更新时间、回收站按删除时间共用这一份规则）。
 * 要求输入已按时间倒序：连续相同标签归为一组，因此返回的组内也保持原序。
 */
export function groupByHistoryLabel<T>(
  items: readonly T[],
  at: (item: T) => number,
  now = Date.now(),
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = historyGroupLabel(at(item), now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

/** 绝对时间：详情页等需要精确时刻的场景（2026 年 9 月 5 日 14:30） */
export function formatFullTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`
}
