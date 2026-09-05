/**
 * 标签列表（plan-v2-accounts.md §6）：返回当前用户的所有标签及使用计数。
 * 标签由片段的写入过程 find-or-create（见 tags.ts），无需独立 CRUD。
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { ok } from '../envelope.js'

export function registerTagRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/', { preHandler: [app.requireAuth] }, async (request) => {
    const ownerId = request.user!.id
    const rows = await prisma.tag.findMany({
      where: { ownerId },
      include: { _count: { select: { snippets: true } } },
      orderBy: { name: 'asc' },
    })
    const data = rows.map((t) => ({ name: t.name, count: t._count.snippets }))
    return ok(data, { total: data.length })
  })
}
