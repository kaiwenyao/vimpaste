/**
 * 收藏夹纯逻辑测试：调色板回落、计数、排序补丁。
 * 排序补丁是重点：order 会重复（服务端默认 0），补丁算错就会出现
 * 「点了上移列表没动」——这里用「应用补丁后的顺序」直接验证结果，而不是比对补丁形状。
 */
import { describe, expect, it } from 'vitest'
import type { ApiCollection } from '../../src/cloud/api'
import {
  canMoveCollection,
  COLLECTION_COLORS,
  countByCollection,
  DEFAULT_COLLECTION_NAME,
  isSystemCollection,
  nextColor,
  normalizeColor,
  planCollectionMove,
  sortCollections,
} from '../../src/utils/collections'

function collection(id: number, over: Partial<ApiCollection> = {}): ApiCollection {
  return { id, name: `c${id}`, color: COLLECTION_COLORS[0].hex, order: 0, ...over }
}

/** 依次应用补丁并返回最终顺序（模拟服务端 PATCH 后重新拉列表的视图） */
function applyMove(list: ApiCollection[], id: number, dir: -1 | 1): ApiCollection[] {
  const patches = planCollectionMove(list, id, dir)
  const patched = list.map((c) => {
    const patch = patches.find((p) => p.id === c.id)
    return patch ? { ...c, order: patch.order } : c
  })
  return sortCollections(patched)
}

describe('收藏夹纯逻辑', () => {
  it('normalizeColor 只接受 #RRGGBB，非法值回落到默认陶土色', () => {
    expect(normalizeColor('#3F8F7D')).toBe('#3f8f7d')
    expect(normalizeColor('#abc')).toBe(COLLECTION_COLORS[0].hex)
    expect(normalizeColor('red')).toBe(COLLECTION_COLORS[0].hex)
    expect(normalizeColor(null)).toBe(COLLECTION_COLORS[0].hex)
    expect(normalizeColor(undefined)).toBe(COLLECTION_COLORS[0].hex)
  })

  it('nextColor 优先挑没被占用的色，用满了也能给出一色', () => {
    expect(nextColor([collection(1, { color: COLLECTION_COLORS[0].hex })])).toBe(
      COLLECTION_COLORS[1].hex,
    )
    const all = COLLECTION_COLORS.map((c, i) => collection(i + 1, { color: c.hex }))
    const next = nextColor(all)
    expect(COLLECTION_COLORS.some((c) => c.hex === next)).toBe(true)
  })

  it('isSystemCollection 只认 default', () => {
    expect(DEFAULT_COLLECTION_NAME).toBe('default')
    expect(isSystemCollection({ name: 'default' })).toBe(true)
    expect(isSystemCollection({ name: '工作' })).toBe(false)
  })

  it('sortCollections 先按 order 再按 id（与服务端 orderBy 一致）', () => {
    const list = [collection(3, { order: 1 }), collection(1, { order: 1 }), collection(2)]
    expect(sortCollections(list).map((c) => c.id)).toEqual([2, 1, 3])
  })

  it('countByCollection 只统计有归属的条目', () => {
    const counts = countByCollection([
      { collectionId: 1 },
      { collectionId: 1 },
      { collectionId: 2 },
      { collectionId: null },
      {},
    ])
    expect(counts).toEqual({ 1: 2, 2: 1 })
  })

  it('上移/下移在 order 全为 0（从未排过序）时也真的换位', () => {
    const list = [collection(1), collection(2), collection(3)]
    expect(applyMove(list, 2, -1).map((c) => c.id)).toEqual([2, 1, 3])
    expect(applyMove(list, 2, 1).map((c) => c.id)).toEqual([1, 3, 2])
    expect(applyMove(list, 1, -1).map((c) => c.id)).toEqual([1, 2, 3])
    expect(applyMove(list, 3, 1).map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('连续排序保持稳定：每次只为顺序不符的条目生成补丁', () => {
    let list = [collection(1), collection(2), collection(3)]
    // 首次排序会把整列归一到下标，因此补丁条数 ≥ 2
    const first = planCollectionMove(list, 3, -1)
    expect(first.length).toBeGreaterThanOrEqual(2)
    list = applyMove(list, 3, -1)
    expect(list.map((c) => c.id)).toEqual([1, 3, 2])
    // 归一之后每次只动两条
    expect(planCollectionMove(list, 3, -1)).toHaveLength(2)
    list = applyMove(list, 3, -1)
    expect(list.map((c) => c.id)).toEqual([3, 1, 2])
  })

  it('边界与未知 id 不产生补丁', () => {
    const list = [collection(1), collection(2)]
    expect(planCollectionMove(list, 1, -1)).toEqual([])
    expect(planCollectionMove(list, 2, 1)).toEqual([])
    expect(planCollectionMove(list, 99, 1)).toEqual([])
    expect(canMoveCollection(list, 1, -1)).toBe(false)
    expect(canMoveCollection(list, 1, 1)).toBe(true)
    expect(canMoveCollection(list, 2, 1)).toBe(false)
    expect(canMoveCollection(list, 99, 1)).toBe(false)
  })
})
