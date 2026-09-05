/**
 * Prisma 行 ↔ API JSON 的序列化：DateTime 统一转 epoch ms（客户端全量走毫秒时间戳）。
 */
import type { Collection, Snippet, Tag } from '@prisma/client'

/** API 返回的 Snippet 形状（时间戳为 epoch ms） */
export interface ApiSnippet {
  id: string
  kind: 'command' | 'prompt'
  title: string
  content: string
  langId: string
  pinned: boolean
  usageCount: number
  lastUsedAt: number | null
  collectionId: number | null
  tags: string[]
  ownerId: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ApiCollection {
  id: number
  name: string
  color: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface ApiTag {
  name: string
  count: number
}

export function toMs(date: Date | null): number | null {
  return date === null ? null : date.getTime()
}

export function serializeSnippet(row: Snippet & { tags: Tag[] }): ApiSnippet {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    langId: row.langId,
    pinned: row.pinned,
    usageCount: row.usageCount,
    lastUsedAt: toMs(row.lastUsedAt),
    collectionId: row.collectionId,
    tags: row.tags.map((t) => t.name),
    ownerId: row.ownerId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: toMs(row.deletedAt),
  }
}

export function serializeCollection(row: Collection): ApiCollection {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    order: row.order,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}
