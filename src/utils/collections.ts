/**
 * 收藏夹的纯逻辑：调色板、排序、计数。
 *
 * 这些函数不碰网络也不碰 DOM，App / 收藏夹面板 / 单元测试共用同一份规则——
 * 排序尤其如此：order 是服务端字段，「上移/下移」必须算出与界面一致的补丁，
 * 否则会出现「点了上移但列表没动」这类只有真机上才复现的错位。
 */
import type { ApiCollection } from '../cloud/api'

/** 服务端懒创建的默认收藏夹：新片段的默认落点，也是唯一不允许重命名/删除的收藏夹 */
export const DEFAULT_COLLECTION_NAME = 'default'

/** 是否是系统收藏夹（default）：重命名会让新片段失去默认落点，删除会被懒创建抵消 */
export function isSystemCollection(collection: { name: string }): boolean {
  return collection.name === DEFAULT_COLLECTION_NAME
}

/**
 * 收藏夹调色板。取自设计稿的色相，但按「用户数据色」调成两组主题下都能辨认的中间调：
 * 这些颜色会写进数据库并在深浅两个主题里渲染为小圆点，不能直接用主题令牌
 * （令牌在深色下是亮色、浅色下是暗色，同一收藏夹换个主题就变色了）。
 */
export const COLLECTION_COLORS = [
  { hex: '#c96442', label: '陶土' },
  { hex: '#d9a24a', label: '琥珀' },
  { hex: '#7d9463', label: '鼠尾草' },
  { hex: '#3f8f7d', label: '青碧' },
  { hex: '#5a7fb8', label: '天青' },
  { hex: '#7a6fb0', label: '靛蓝' },
  { hex: '#c06a86', label: '玫瑰' },
  { hex: '#8a7f70', label: '石墨' },
] as const

/** 服务端 schema 只收 #RRGGBB：非法值（旧数据/手改数据库）回落到默认陶土色 */
export function normalizeColor(color: string | null | undefined): string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)
    ? color.toLowerCase()
    : COLLECTION_COLORS[0].hex
}

/** 新建收藏夹时的默认颜色：优先挑一个还没被占用的色，用满了再从第一个轮回 */
export function nextColor(collections: ApiCollection[]): string {
  const used = new Set(collections.map((c) => normalizeColor(c.color)))
  const free = COLLECTION_COLORS.find((c) => !used.has(c.hex))
  return free?.hex ?? COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length].hex
}

/** 与服务端 orderBy([{order:'asc'},{id:'asc'}]) 保持一致，避免前后端两种顺序 */
export function sortCollections(collections: ApiCollection[]): ApiCollection[] {
  return [...collections].sort((a, b) => a.order - b.order || a.id - b.id)
}

export interface CollectionOrderPatch {
  id: number
  order: number
}

/**
 * 上移（dir=-1）/ 下移（dir=1）一个收藏夹，返回需要 PATCH 的 {id, order} 列表。
 *
 * order 会重复：服务端默认 0，从没排过序的账号每个收藏夹都是 0。只交换相邻两条的
 * order 在重复值下等于没换，因此这里先把目标顺序算出来，再让每条目的 order 归一到
 * 它在列表里的下标，只对「与目标下标不符」的条目生成补丁——首次排序会补几条，之后
 * 每次只补两条。
 *
 * 补丁按列表顺序返回，调用方依次应用后 sortCollections 即是目标顺序（测试保证）。
 */
export function planCollectionMove(
  collections: ApiCollection[],
  id: number,
  dir: -1 | 1,
): CollectionOrderPatch[] {
  const sorted = sortCollections(collections)
  const from = sorted.findIndex((c) => c.id === id)
  if (from < 0) return []
  const to = from + dir
  if (to < 0 || to >= sorted.length) return []
  const next = [...sorted]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const patches: CollectionOrderPatch[] = []
  next.forEach((collection, index) => {
    if (collection.order !== index) patches.push({ id: collection.id, order: index })
  })
  return patches
}

/** 收藏夹列表里能不能再上移/下移（边界上按钮置灰，而不是点了没反应） */
export function canMoveCollection(collections: ApiCollection[], id: number, dir: -1 | 1): boolean {
  const sorted = sortCollections(collections)
  const from = sorted.findIndex((c) => c.id === id)
  if (from < 0) return false
  const to = from + dir
  return to >= 0 && to < sorted.length
}

/** 每个收藏夹的条目数：键是收藏夹 id，未分类（collectionId 为空）不计入 */
export function countByCollection(
  entries: { collectionId?: number | null }[],
): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const entry of entries) {
    const id = entry.collectionId
    if (typeof id !== 'number') continue
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}
