/**
 * 定时清理任务（plan-v2-accounts.md §5.1/§7.1）：
 * - 墓碑硬删：软删除保留 TOMBSTONE_RETENTION_DAYS 天供其它设备同步，到期物理删除；
 * - 过期会话清理：会话只在被再次访问时惰性删除，用户不再回来的会话会一直留存；
 * - 孤儿标签清理：片段被硬删或改掉标签后，引用计数归零的标签不再有意义。
 * 单实例部署，setInterval 足矣；各项独立容错，失败只记日志，下一轮自然重试。
 */
import type { PrismaClient } from '@prisma/client'

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000

export function startTombstonePurgeJob(
  prisma: PrismaClient,
  retentionDays: number,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): NodeJS.Timeout {
  const purge = async (): Promise<void> => {
    const boundary = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const now = new Date()
    const jobs: [string, () => Promise<{ count: number }>][] = [
      [
        '墓碑硬删',
        () => prisma.snippet.deleteMany({ where: { deletedAt: { not: null, lt: boundary } } }),
      ],
      ['过期会话清理', () => prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })],
      ['孤儿标签清理', () => prisma.tag.deleteMany({ where: { snippets: { none: {} } } })],
    ]
    for (const [name, run] of jobs) {
      try {
        const result = await run()
        if (result.count > 0) log.info({ count: result.count }, `${name}完成`)
      } catch (error) {
        log.error({ error: error instanceof Error ? error.message : String(error) }, `${name}失败`)
      }
    }
  }

  const timer = setInterval(() => void purge(), RUN_INTERVAL_MS)
  timer.unref()
  // 启动后先跑一次（覆盖长时间停机期间到期的墓碑）
  void purge()
  return timer
}
