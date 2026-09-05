/**
 * 服务启动入口（plan-v2-accounts.md §4.1）：
 * 环境变量校验失败即退出（不允许运行时才炸），监听 PORT。
 */
import { loadEnv } from './env.js'
import { buildApp } from './app.js'
import { prisma } from './db.js'
import { startTombstonePurgeJob } from './jobs/purge.js'

async function main(): Promise<void> {
  const env = loadEnv()
  const app = await buildApp({ env, prisma })
  startTombstonePurgeJob(prisma, env.TOMBSTONE_RETENTION_DAYS, app.log)

  // 优雅退出：给在途请求一点时间完成，再断开数据库连接
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '收到退出信号，开始优雅关闭')
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
