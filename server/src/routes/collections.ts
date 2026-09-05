/**
 * 集合 CRUD（plan-v2-accounts.md §6）：单归属「文件夹」，(name, ownerId) 唯一。
 * 删除集合时条目的 collectionId 由外键 SetNull，条目本身不受影响。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { fail, ok } from '../envelope.js'
import { collectionCreateSchema, collectionPatchSchema } from '../schemas/snippet.js'
import { serializeCollection } from './serialize.js'

function parseIdParam(request: FastifyRequest): number {
  const { id } = request.params as { id?: string }
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw fail(404, 'NOT_FOUND', '集合不存在')
  return n
}

export function registerCollectionRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/', { preHandler: [app.requireAuth] }, async (request) => {
    const ownerId = request.user!.id
    const rows = await prisma.collection.findMany({
      where: { ownerId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    return ok(rows.map(serializeCollection), { total: rows.length })
  })

  app.post('/', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const body = collectionCreateSchema.parse(request.body)
    const dup = await prisma.collection.findUnique({
      where: { name_ownerId: { name: body.name, ownerId } },
    })
    if (dup) throw fail(409, 'NAME_TAKEN', '同名集合已存在')
    const row = await prisma.collection.create({ data: { ...body, ownerId } })
    return reply.code(201).send(ok(serializeCollection(row)))
  })

  app.patch('/:id', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const id = parseIdParam(request)
    const body = collectionPatchSchema.parse(request.body)
    const existing = await prisma.collection.findUnique({ where: { id } })
    if (!existing || existing.ownerId !== ownerId) {
      throw fail(404, 'NOT_FOUND', '集合不存在')
    }
    if (body.name !== undefined && body.name !== existing.name) {
      const dup = await prisma.collection.findUnique({
        where: { name_ownerId: { name: body.name, ownerId } },
      })
      if (dup) throw fail(409, 'NAME_TAKEN', '同名集合已存在')
    }
    const row = await prisma.collection.update({ where: { id }, data: body })
    return reply.send(ok(serializeCollection(row)))
  })

  app.delete('/:id', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const ownerId = request.user!.id
    const id = parseIdParam(request)
    const existing = await prisma.collection.findUnique({ where: { id } })
    if (!existing || existing.ownerId !== ownerId) {
      throw fail(404, 'NOT_FOUND', '集合不存在')
    }
    // 显式置空并推进 syncedAt：其它设备按游标拉取后才能得知条目已脱离该集合
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
