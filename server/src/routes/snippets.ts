/**
 * Snippet 路由（plan-v2-accounts.md §6、§7.1）：
 * - 全部挂在 requireAuth 之后，ownerId 只取自会话，请求体不可指定；
 * - 时间戳由客户端提供，入库前钳制；
 * - POST /sync 一个端点完成上行推送 + 下行拉取，冲突不覆盖、回传服务端版本。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient, Snippet, Tag } from '@prisma/client'
import { fail, ok } from '../envelope.js'
import type { Env } from '../env.js'
import {
  makeSnippetPatchSchema,
  makeSnippetPayloadSchema,
  snippetQuerySchema,
  syncSchema,
} from '../schemas/snippet.js'
import { clampSnippetTimestamps } from '../schemas/timestamps.js'
import { connectTags } from './tags.js'
import { serializeSnippet, type ApiSnippet } from './serialize.js'

type SnippetWithTags = Snippet & { tags: Tag[] }

/** cursor 编解码：base64url("<updatedAt>:<id>") */
function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${row.updatedAt.getTime()}:${row.id}`).toString('base64url')
}

function decodeCursor(raw: string): { updatedAt: Date; id: string } | null {
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const sep = decoded.indexOf(':')
  if (sep <= 0) return null
  const ms = Number(decoded.slice(0, sep))
  const id = decoded.slice(sep + 1)
  if (!Number.isFinite(ms) || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { updatedAt: new Date(ms), id }
}

/** 校验 collectionId 归属；非法时抛 400 */
async function assertCollectionOwned(
  prisma: PrismaClient,
  ownerId: number,
  collectionId: number,
): Promise<void> {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId } })
  if (!collection || collection.ownerId !== ownerId) {
    throw fail(400, 'VALIDATION_FAILED', 'collectionId 不存在或不属于当前用户')
  }
}

export function registerSnippetRoutes(app: FastifyInstance, prisma: PrismaClient, env: Env): void {
  const snippetPayloadSchema = makeSnippetPayloadSchema(env.MAX_CONTENT_CHARS)
  const snippetPatchSchema = makeSnippetPatchSchema(env.MAX_CONTENT_CHARS)
  const syncBodySchema = syncSchema(env.MAX_CONTENT_CHARS)

  app.get(
    '/',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = snippetQuerySchema.parse(request.query)
      const ownerId = request.user!.id
      const where: Prisma.SnippetWhereInput = {
        ownerId,
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.collectionId ? { collectionId: query.collectionId } : {}),
        ...(query.tag ? { tags: { some: { name: query.tag, ownerId } } } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { content: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      }
      const cursor = query.cursor ? decodeCursor(query.cursor) : null
      if (query.cursor && !cursor) {
        throw fail(400, 'VALIDATION_FAILED', 'cursor 非法')
      }
      const rows = await prisma.snippet.findMany({
        where: {
          ...where,
          ...(cursor
            ? {
                OR: [
                  { updatedAt: { lt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: { tags: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const hasMore = rows.length > query.limit
      const page = hasMore ? rows.slice(0, query.limit) : rows
      const total = await prisma.snippet.count({ where })
      const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : undefined
      return reply.send({
        ok: true,
        data: page.map(serializeSnippet),
        meta: nextCursor ? { total, cursor: nextCursor } : { total },
      })
    },
  )

  /** 创建（幂等）：id 已存在时按 upsert 处理——仅当传入版本更新才覆盖 */
  app.post(
    '/',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = snippetPayloadSchema.parse(request.body)
      const ownerId = request.user!.id
      const sanitized = clampSnippetTimestamps(payload)
      if (sanitized.collectionId !== null) {
        await assertCollectionOwned(prisma, ownerId, sanitized.collectionId)
      }
      const existing = await prisma.snippet.findUnique({
        where: { id: sanitized.id },
        include: { tags: true },
      })
      if (existing && existing.ownerId !== ownerId) {
        // UUID 撞上他人条目：绝不覆盖、不回传对方数据，按冲突处理
        throw fail(409, 'ID_CONFLICT', '条目 id 已被占用')
      }
      if (existing) {
        if (sanitized.updatedAt > existing.updatedAt.getTime()) {
          const updated = await prisma.snippet.update({
            where: { id: sanitized.id },
            data: dataFromPayload(sanitized),
          })
          await connectTags(prisma, ownerId, sanitized.tags, updated.id)
          const row = await prisma.snippet.findUniqueOrThrow({
            where: { id: updated.id },
            include: { tags: true },
          })
          return reply.send(ok(serializeSnippet(row)))
        }
        return reply.send(ok(serializeSnippet(existing)))
      }
      await assertQuota(prisma, ownerId, env.MAX_SNIPPETS_PER_USER)
      const created = await prisma.snippet.create({
        data: {
          id: sanitized.id,
          ownerId,
          kind: sanitized.kind,
          title: sanitized.title,
          content: sanitized.content,
          langId: sanitized.langId,
          pinned: sanitized.pinned,
          usageCount: sanitized.usageCount,
          lastUsedAt: sanitized.lastUsedAt === null ? null : new Date(sanitized.lastUsedAt),
          collectionId: sanitized.collectionId,
          createdAt: new Date(sanitized.createdAt),
          updatedAt: new Date(sanitized.updatedAt),
          deletedAt: null,
        },
      })
      await connectTags(prisma, ownerId, sanitized.tags, created.id)
      const row = await prisma.snippet.findUniqueOrThrow({
        where: { id: created.id },
        include: { tags: true },
      })
      return reply.code(201).send(ok(serializeSnippet(row)))
    },
  )

  app.patch(
    '/:id',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const id = parseUuidParam(request)
      const patch = snippetPatchSchema.parse(request.body)
      const existing = await prisma.snippet.findUnique({ where: { id } })
      if (!existing || existing.ownerId !== ownerId || existing.deletedAt) {
        throw fail(404, 'NOT_FOUND', '条目不存在')
      }
      // 乐观并发：客户端带它看到的 updatedAt；服务端已更新到更新的版本时拒绝覆盖
      const clientUpdatedAt = clampTimestampValue(patch.updatedAt)
      if (clientUpdatedAt < existing.updatedAt.getTime()) {
        throw fail(409, 'UPDATE_CONFLICT', '条目已在其他设备上被更新，请先同步')
      }
      if (patch.collectionId) {
        await assertCollectionOwned(prisma, ownerId, patch.collectionId)
      }
      const updatedAt = new Date(Math.max(clientUpdatedAt, existing.updatedAt.getTime()))
      await prisma.snippet.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          ...(patch.langId !== undefined ? { langId: patch.langId } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
          ...(patch.usageCount !== undefined ? { usageCount: patch.usageCount } : {}),
          ...(patch.lastUsedAt !== undefined
            ? { lastUsedAt: patch.lastUsedAt === null ? null : new Date(patch.lastUsedAt) }
            : {}),
          ...(patch.collectionId !== undefined ? { collectionId: patch.collectionId } : {}),
          updatedAt,
        },
      })
      if (patch.tags !== undefined) {
        await connectTags(prisma, ownerId, patch.tags, id)
      }
      const row = await prisma.snippet.findUniqueOrThrow({ where: { id }, include: { tags: true } })
      return reply.send(ok(serializeSnippet(row)))
    },
  )

  /** 软删除（写墓碑）；重复删除幂等 */
  app.delete(
    '/:id',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const id = parseUuidParam(request)
      const existing = await prisma.snippet.findUnique({ where: { id } })
      if (!existing || existing.ownerId !== ownerId) {
        // 对不属于自己的 id 返回 404，不泄露存在性
        throw fail(404, 'NOT_FOUND', '条目不存在')
      }
      if (!existing.deletedAt) {
        await prisma.snippet.update({
          where: { id },
          data: { deletedAt: new Date() },
        })
      }
      return reply.send(ok({ id, deleted: true }))
    },
  )

  /**
   * 批量同步（§7.1）：上行 changes + 下行 pulled。
   * 冲突（客户端 updatedAt 早于服务端）不覆盖，放进 conflicts 回传服务端版本，
   * 由客户端另存「（冲突副本）」——绝不静默丢弃用户写过的字。
   */
  app.post(
    '/sync',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const body = syncBodySchema.parse(request.body)
      const now = Date.now()

      const applied: string[] = []
      const conflicts: { id: string; server: ApiSnippet | null }[] = []

      // 配额：一次性检查「新增条数 + 现有条数」是否超限
      const newIds: string[] = []
      for (const change of body.changes) newIds.push(change.id)
      const existingRows = await prisma.snippet.findMany({
        where: { id: { in: newIds } },
        select: { id: true, ownerId: true, updatedAt: true, deletedAt: true },
      })
      const existingById = new Map(existingRows.map((r) => [r.id, r]))
      const creates = body.changes.filter((c) => {
        const row = existingById.get(c.id)
        return !row || row.ownerId !== ownerId
      })
      // 他人占用的 id 按「不可创建」处理，不计配额
      const foreignIds = new Set(
        creates
          .filter((c) => {
            const row = existingById.get(c.id)
            return row !== undefined && row.ownerId !== ownerId
          })
          .map((c) => c.id),
      )
      const creatableCount = creates.length - foreignIds.size
      const currentCount = await prisma.snippet.count({ where: { ownerId, deletedAt: null } })
      if (currentCount + creatableCount > env.MAX_SNIPPETS_PER_USER) {
        throw fail(409, 'QUOTA_EXCEEDED', `条目数超出上限（${env.MAX_SNIPPETS_PER_USER}）`)
      }

      for (const raw of body.changes) {
        const change = clampSnippetTimestamps(raw, now)
        const existing = existingById.get(change.id)
        if (existing && existing.ownerId !== ownerId) {
          // UUID 撞上他人的条目：不覆盖也不回传对方数据
          conflicts.push({ id: change.id, server: null })
          continue
        }
        if (!existing) {
          const created = await prisma.snippet.create({
            data: {
              id: change.id,
              ownerId,
              kind: change.kind,
              title: change.title,
              content: change.content,
              langId: change.langId,
              pinned: change.pinned,
              usageCount: change.usageCount,
              lastUsedAt: change.lastUsedAt === null ? null : new Date(change.lastUsedAt),
              collectionId: change.collectionId,
              createdAt: new Date(change.createdAt),
              updatedAt: new Date(change.updatedAt),
              deletedAt: null,
            },
          })
          if (change.tags.length > 0) {
            await connectTags(prisma, ownerId, change.tags, created.id)
          }
          applied.push(created.id)
          continue
        }
        if (change.updatedAt > existing.updatedAt.getTime()) {
          await prisma.snippet.update({
            where: { id: change.id },
            data: {
              kind: change.kind,
              title: change.title,
              content: change.content,
              langId: change.langId,
              pinned: change.pinned,
              usageCount: change.usageCount,
              lastUsedAt: change.lastUsedAt === null ? null : new Date(change.lastUsedAt),
              collectionId: change.collectionId,
              updatedAt: new Date(change.updatedAt),
            },
          })
          await connectTags(prisma, ownerId, change.tags, change.id)
          applied.push(change.id)
          continue
        }
        const serverRow = await prisma.snippet.findUnique({
          where: { id: change.id },
          include: { tags: true },
        })
        if (serverRow) conflicts.push({ id: change.id, server: serializeSnippet(serverRow) })
      }

      // 下行：updatedAt > since 的全部条目（含墓碑，供其它设备执行删除）
      const pulledRows: SnippetWithTags[] = await prisma.snippet.findMany({
        where: { ownerId, updatedAt: { gt: new Date(body.since) } },
        include: { tags: true },
        orderBy: { updatedAt: 'asc' },
      })

      return reply.send(
        ok(
          {
            applied,
            conflicts,
            pulled: pulledRows.map(serializeSnippet),
            now,
          },
          { total: pulledRows.length },
        ),
      )
    },
  )
}

function parseUuidParam(request: FastifyRequest): string {
  const { id } = request.params as { id?: string }
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw fail(404, 'NOT_FOUND', '条目不存在')
  }
  return id
}

function clampTimestampValue(ms: number): number {
  const now = Date.now()
  const FUTURE = 5 * 60 * 1000
  if (!Number.isFinite(ms) || ms > now + FUTURE || ms < Date.UTC(1990, 0, 1)) return now
  return ms
}

function dataFromPayload(s: {
  kind: 'command' | 'prompt'
  title: string
  content: string
  langId: string
  pinned: boolean
  usageCount: number
  lastUsedAt: number | null
  collectionId: number | null
  updatedAt: number
}) {
  return {
    kind: s.kind,
    title: s.title,
    content: s.content,
    langId: s.langId,
    pinned: s.pinned,
    usageCount: s.usageCount,
    lastUsedAt: s.lastUsedAt === null ? null : new Date(s.lastUsedAt),
    collectionId: s.collectionId,
    updatedAt: new Date(s.updatedAt),
  }
}

async function assertQuota(prisma: PrismaClient, ownerId: number, max: number): Promise<void> {
  const count = await prisma.snippet.count({ where: { ownerId, deletedAt: null } })
  if (count >= max) {
    throw fail(409, 'QUOTA_EXCEEDED', `条目数超出上限（${max}）`)
  }
}
