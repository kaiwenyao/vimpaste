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

/** 回收站列表单页上限：回收站是「最近删的东西」，不值得翻页 */
const TRASH_PAGE_LIMIT = 200

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

/**
 * sync 端点的 collectionId 归属解析：非法（不存在或属于他人）一律置 null，
 * 不让整批 sync 400/500——收藏夹归属只是元数据，内容必须照常同步，
 * 否则一条失效引用会把客户端队列永远堵住。直接 CRUD 路由仍走 assertCollectionOwned 报 400。
 */
async function resolveOwnedCollectionId(
  prisma: PrismaClient,
  ownerId: number,
  collectionId: number | null,
): Promise<number | null> {
  if (collectionId === null) return null
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  })
  return collection && collection.ownerId === ownerId ? collectionId : null
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
                { note: { contains: query.q, mode: 'insensitive' } },
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
            data: { ...dataFromPayload(sanitized), syncedAt: new Date() },
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
          // 创建行时省略视为无备注；更新路径由 dataFromPayload 区分省略与显式 null
          note: sanitized.note ?? null,
          langId: sanitized.langId,
          pinned: sanitized.pinned,
          usageCount: sanitized.usageCount,
          lastUsedAt: sanitized.lastUsedAt === null ? null : new Date(sanitized.lastUsedAt),
          collectionId: sanitized.collectionId,
          createdAt: new Date(sanitized.createdAt),
          updatedAt: new Date(sanitized.updatedAt),
          syncedAt: new Date(),
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
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.langId !== undefined ? { langId: patch.langId } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
          ...(patch.usageCount !== undefined ? { usageCount: patch.usageCount } : {}),
          ...(patch.lastUsedAt !== undefined
            ? { lastUsedAt: patch.lastUsedAt === null ? null : new Date(patch.lastUsedAt) }
            : {}),
          ...(patch.collectionId !== undefined ? { collectionId: patch.collectionId } : {}),
          updatedAt,
          syncedAt: new Date(),
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
        const now = new Date()
        await prisma.snippet.update({
          where: { id },
          // 墓碑必须同步推进 updatedAt / syncedAt：增量拉取按这两个游标过滤，
          // 不推进的话游标较新的设备永远收不到这条删除
          data: { deletedAt: now, updatedAt: now, syncedAt: now },
        })
      }
      return reply.send(ok({ id, deleted: true }))
    },
  )

  /**
   * 回收站列表：只列墓碑，按删除时间倒序（最近删的在最前）。
   * `meta.retentionDays` 回传部署实际配置的保留天数（自托管可改
   * TOMBSTONE_RETENTION_DAYS），客户端不硬编码 30。
   */
  app.get(
    '/trash',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const where: Prisma.SnippetWhereInput = { ownerId, deletedAt: { not: null } }
      const [rows, total] = await Promise.all([
        prisma.snippet.findMany({
          where,
          include: { tags: true },
          orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
          take: TRASH_PAGE_LIMIT,
        }),
        prisma.snippet.count({ where }),
      ])
      return reply.send({
        ok: true,
        data: rows.map(serializeSnippet),
        meta: { total, retentionDays: env.TOMBSTONE_RETENTION_DAYS },
      })
    },
  )

  /**
   * 清空回收站：硬删当前用户的全部墓碑（不可恢复）。
   *
   * 静态段 `/trash` 与 `DELETE /:id` 同层：find-my-way 静态优先，
   * 所以这里不会被 `/:id` 处理器当作「id 为 trash 的条目」而 404（有专门用例锁定）。
   */
  app.delete(
    '/trash',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const result = await prisma.snippet.deleteMany({
        where: { ownerId, deletedAt: { not: null } },
      })
      return reply.send(ok({ count: result.count }))
    },
  )

  /**
   * 从回收站恢复（与软删除对称）：清墓碑并**同时推进** updatedAt / syncedAt。
   * 两个游标缺一不可——增量拉取按 syncedAt 过滤，只看 updatedAt 的话
   * 游标较新的设备永远拉不到这条「恢复」，条目会在那台机器上永久消失。
   * 已不在回收站里的条目幂等返回当前状态。
   */
  app.post(
    '/:id/restore',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const id = parseUuidParam(request)
      const existing = await prisma.snippet.findUnique({ where: { id }, include: { tags: true } })
      if (!existing || existing.ownerId !== ownerId) {
        throw fail(404, 'NOT_FOUND', '条目不存在')
      }
      if (!existing.deletedAt) {
        return reply.send(ok(serializeSnippet(existing)))
      }
      // 不做配额校验：条目本来就是该用户的、且此前已占过名额，
      // 因为「额度满了」而拒绝恢复自己的数据比短暂超额更糟
      const now = new Date()
      const row = await prisma.snippet.update({
        where: { id },
        data: { deletedAt: null, updatedAt: now, syncedAt: now },
        include: { tags: true },
      })
      return reply.send(ok(serializeSnippet(row)))
    },
  )

  /**
   * 彻底删除单条墓碑（不可恢复）。只对回收站里的条目生效：
   * 在用条目必须先软删——否则一次误调就把用户的条目永久抹掉。
   */
  app.delete(
    '/:id/purge',
    { preHandler: [app.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerId = request.user!.id
      const id = parseUuidParam(request)
      const existing = await prisma.snippet.findUnique({
        where: { id },
        select: { ownerId: true, deletedAt: true },
      })
      if (!existing || existing.ownerId !== ownerId) {
        throw fail(404, 'NOT_FOUND', '条目不存在')
      }
      if (!existing.deletedAt) {
        throw fail(409, 'NOT_TRASHED', '条目不在回收站中，请先删除再彻底清除')
      }
      await prisma.snippet.delete({ where: { id } })
      return reply.send(ok({ id, purged: true }))
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
              note: change.note ?? null,
              langId: change.langId,
              pinned: change.pinned,
              usageCount: change.usageCount,
              lastUsedAt: change.lastUsedAt === null ? null : new Date(change.lastUsedAt),
              collectionId: await resolveOwnedCollectionId(prisma, ownerId, change.collectionId),
              createdAt: new Date(change.createdAt),
              updatedAt: new Date(change.updatedAt),
              syncedAt: new Date(),
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
              // 旧版客户端不送 note 时不得覆盖服务端已有备注：省略 ≠ 显式 null
              ...(change.note !== undefined ? { note: change.note } : {}),
              langId: change.langId,
              pinned: change.pinned,
              usageCount: change.usageCount,
              lastUsedAt: change.lastUsedAt === null ? null : new Date(change.lastUsedAt),
              collectionId: await resolveOwnedCollectionId(prisma, ownerId, change.collectionId),
              updatedAt: new Date(change.updatedAt),
              syncedAt: new Date(),
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

      // 下行基线在本轮写入全部落库后取值：本轮刚应用的条目 syncedAt ≤ 基线，
      // 不会在下一轮被重复拉回。基线必须早于拉取查询本身（并发写入只可能重复、不能漏）。
      const servedAt = Date.now()

      // 下行：syncedAt > since 的全部条目（含墓碑，供其它设备执行删除）。
      // 游标用服务端写入时间而不是客户端 updatedAt：离线修改会带着旧时钟
      // 时间戳被后补推送，按 updatedAt 过滤会被其它设备的游标永久越过。
      const pulledRows: SnippetWithTags[] = await prisma.snippet.findMany({
        where: { ownerId, syncedAt: { gt: new Date(body.since) } },
        include: { tags: true },
        orderBy: { syncedAt: 'asc' },
      })

      return reply.send(
        ok(
          {
            applied,
            conflicts,
            pulled: pulledRows.map(serializeSnippet),
            now: servedAt,
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
  note?: string | null
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
    // 旧版客户端不送 note 时不得覆盖服务端已有备注：省略 ≠ 显式 null
    ...(s.note !== undefined ? { note: s.note } : {}),
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
