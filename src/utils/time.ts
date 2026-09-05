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

/** 绝对时间：详情页等需要精确时刻的场景（2026 年 9 月 5 日 14:30） */
export function formatFullTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`
}
