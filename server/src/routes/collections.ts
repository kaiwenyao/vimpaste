/**
 * 收藏夹 CRUD（plan-v2-accounts.md §6）：单归属「文件夹」，(name, ownerId) 唯一。
 * 删除收藏夹时条目的 collectionId 由外键 SetNull，条目本身不受影响。
 * 用户没有任何收藏夹时，GET 列表会懒创建 default——注册、CLI 建号、种子数据
 * 等所有建号路径由此统一获得默认落点，新片段保存时默认进 default。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { fail, ok } from '../envelope.js'
import { collectionCreateSchema, collectionPatchSchema } from '../schemas/snippet.js'
import { serializeCollection } from './serialize.js'

const DEFAULT_COLLECTION_NAME = 'default'

/** upsert 保证并发 GET 下也只有一个 default（(name, ownerId) 唯一约束兜底） */
async function ensureDefaultCollection(
  prisma: PrismaClient,
  ownerId: number,
): Promise<ReturnType<typeof serializeCollection>> {
  const row = await prisma.collection.upsert({
    where: { name_ownerId: { name: DEFAULT_COLLECTION_NAME, ownerId } },
    update: {},
    create: { name: DEFAULT_COLLECTION_NAME, ownerId },
  })
  return serializeCollection(row)
}

function parseIdParam(request: FastifyRequest): number {
  const { id } = request.params as { id?: string }
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw fail(404, 'NOT_FOUND', '收藏夹不存在')
  return n
}

export function registerCollectionRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/', { preHandler: [app.requireAuth] }, async (request) => {
    const ownerId = request.user!.id
    const rows = await prisma.collection.findMany({
      where: { ownerId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    if (rows.length === 0) {
      return ok([await ensureDefaultCollection(prisma, ownerId)], { total: 1 })
    }
    return ok(rows.map(serializeCollection), { total: rows.length })
  })

  app.post('/', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const body = collectionCreateSchema.parse(request.body)
    const dup = await prisma.collection.findUnique({
      where: { name_ownerId: { name: body.name, ownerId } },
    })
    if (dup) throw fail(409, 'NAME_TAKEN', '同名收藏夹已存在')
    const row = await prisma.collection.create({ data: { ...body, ownerId } })
    return reply.code(201).send(ok(serializeCollection(row)))
  })

  app.patch('/:id', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const id = parseIdParam(request)
    const body = collectionPatchSchema.parse(request.body)
    const existing = await prisma.collection.findUnique({ where: { id } })
    if (!existing || existing.ownerId !== ownerId) {
      throw fail(404, 'NOT_FOUND', '收藏夹不存在')
    }
    if (body.name !== undefined && body.name !== existing.name) {
      const dup = await prisma.collection.findUnique({
        where: { name_ownerId: { name: body.name, ownerId } },
      })
      if (dup) throw fail(409, 'NAME_TAKEN', '同名收藏夹已存在')
    }
    const row = await prisma.collection.update({ where: { id }, data: body })
    return reply.send(ok(serializeCollection(row)))
  })

  app.delete('/:id', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const id = parseIdParam(request)
    const existing = await prisma.collection.findUnique({ where: { id } })
    if (!existing || existing.ownerId !== ownerId) {
      throw fail(404, 'NOT_FOUND', '收藏夹不存在')
    }
    // 显式置空并推进 syncedAt：其它设备按游标拉取后才能得知条目已脱离该收藏夹
    //（只靠外键 SetNull 不会触发任何游标变化，缓存会一直留着失效的 collectionId）
    await prisma.$transaction([
      prisma.snippet.updateMany({
        where: { collectionId: id, ownerId },
        data: { collectionId: null, syncedAt: new Date() },
      }),
      prisma.collection.delete({ where: { id } }),
    ])
    return reply.send(ok({ id, deleted: true }))
  })
}
