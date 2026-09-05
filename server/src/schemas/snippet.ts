/**
 * 请求体 zod schema（plan-v2-accounts.md §6）。
 * 校验失败返回 400 VALIDATION_FAILED，且错误详情只含字段路径，不回显原始输入。
 */
import { z } from 'zod'

export const SNIPPET_KINDS = ['command', 'prompt'] as const
export type SnippetKind = (typeof SNIPPET_KINDS)[number]

/** langId 由前端 isLangId() 白名单校验后写入；服务端只约束安全字符集 */
export const langIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, 'langId 格式非法')
  .default('plaintext')

export const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // 控制字符用码点判断（避免 no-control-regex 的字面控制字符正则）
  .refine((v) => ![...v].some((ch) => ch.charCodeAt(0) < 0x20), 'tag 不能含控制字符')

export function makeSnippetPayloadSchema(maxContentChars: number) {
  return z.object({
    id: z.string().uuid(),
    kind: z.enum(SNIPPET_KINDS),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(maxContentChars),
    langId: langIdSchema,
    pinned: z.boolean().default(false),
    usageCount: z.number().int().min(0).max(10_000_000).default(0),
    /** epoch ms；null 表示从未使用 */
    lastUsedAt: z.number().int().nullable().default(null),
    collectionId: z.number().int().positive().nullable().default(null),
    tags: z.array(tagSchema).max(20).default([]),
    /** 客户端时间戳（epoch ms）：表达「另一台机器上离线改的」，服务端钳制后入库 */
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
}

export type SnippetPayload = z.output<ReturnType<typeof makeSnippetPayloadSchema>>

/** PATCH /snippets/:id：全部可选，updatedAt 必带用于乐观并发 */
export function makeSnippetPatchSchema(maxContentChars: number) {
  return z.object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(maxContentChars).optional(),
    langId: langIdSchema.optional(),
    kind: z.enum(SNIPPET_KINDS).optional(),
    pinned: z.boolean().optional(),
    usageCount: z.number().int().min(0).max(10_000_000).optional(),
    lastUsedAt: z.number().int().nullable().optional(),
    collectionId: z.number().int().positive().nullable().optional(),
    tags: z.array(tagSchema).max(20).optional(),
    updatedAt: z.number().int(),
  })
}

export type SnippetPatch = z.output<ReturnType<typeof makeSnippetPatchSchema>>

export const syncSchema = (maxContentChars: number) =>
  z.object({
    since: z.number().int().min(0).default(0),
    changes: z.array(makeSnippetPayloadSchema(maxContentChars)).max(500).default([]),
  })

export const collectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#c96442'),
  order: z.number().int().min(0).max(10_000).default(0),
})

export const collectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  order: z.number().int().min(0).max(10_000).optional(),
})

/** 会话查询参数 */
export const snippetQuerySchema = z.object({
  kind: z.enum(SNIPPET_KINDS).optional(),
  q: z.string().trim().max(200).optional(),
  collectionId: z.coerce.number().int().positive().optional(),
  tag: z.string().trim().max(64).optional(),
  /** 只返回 updatedAt > since 的条目（含墓碑） */
  since: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** keyset 游标：base64url("<updatedAt>:<id>") */
  cursor: z.string().max(256).optional(),
})
