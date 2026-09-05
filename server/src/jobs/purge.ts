/**
 * 墓碑硬删定时任务（plan-v2-accounts.md §5.1/§7.1）：
 * 软删除的条目保留 TOMBSTONE_RETENTION_DAYS 天供其它设备同步，到期物理删除。
 * 单实例部署，setInterval 足矣；失败只记日志，下一轮自然重试。
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
    try {
      const result = await prisma.snippet.deleteMany({
        where: { deletedAt: { not: null, lt: boundary } },
      })
      if (result.count > 0) log.info({ count: result.count }, '墓碑硬删完成')
    } catch (error) {
      log.error({ error: error instanceof Error ? error.message : String(error) }, '墓碑硬删失败')
    }
  }

  const timer = setInterval(() => void purge(), RUN_INTERVAL_MS)
  timer.unref()
  // 启动后先跑一次（覆盖长时间停机期间到期的墓碑）
  void purge()
  return timer
}
