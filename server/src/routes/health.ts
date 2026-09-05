/**
 * 探针路由（plan-v2-accounts.md §6）：
 * - /api/healthz 存活探针：不查库，进程活着即 200；
 * - /api/readyz 就绪探针：执行一次轻量查询，库不可达时 503。
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { ok } from '../envelope.js'
import { fail } from '../envelope.js'

export function registerHealthRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/healthz', async () => ok({ status: 'ok' }))

  app.get('/readyz', async (_request, reply: FastifyReply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return ok({ status: 'ready' })
    } catch {
      return reply.code(503).send(fail(503, 'NOT_READY', '数据库不可达'))
    }
  })
}
