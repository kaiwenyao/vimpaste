/**
 * Prisma client 单例（plan-v2-accounts.md §4.1）。
 * 连接池大小通过 DATABASE_URL 的连接参数控制（如 ?connection_limit=10&pool_timeout=10），
 * 不在代码里写死——不同部署（本机 docker / k3s）容量差异大，配置留给环境。
 */
import { PrismaClient } from '@prisma/client'

/**
 * dev（tsx watch）热重载会反复执行本模块：把实例挂到 globalThis 上复用，
 * 避免耗尽 Postgres 连接。生产进程只初始化一次，不受影响。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
