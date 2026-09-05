/**
 * 登录失败按账号指数退避（plan-v2-accounts.md Phase 2）。
 *
 * 与 IP 限流互补：IP 限流挡分布式撞库，这里挡「同一账号慢慢试」。
 * 进程内存态即可：多实例部署时每份实例独立退避，总力度只松不紧，可接受；
 * 重启清零的代价也只是多几次尝试机会，不换取「账号被永久锁死」的DoS面。
 */

interface BackoffState {
  failures: number
  /** 该时刻之前拒绝该账号的登录尝试（epoch ms） */
  blockedUntil: number
}

const attempts = new Map<string, BackoffState>()

/** 第 n 次失败后的封禁时长：2 次失败封 1s，之后 2s, 4s, … 上限 15 分钟 */
export function backoffDelay(failures: number): number {
  return Math.min(2 ** (failures - 2) * 1000, 15 * 60 * 1000)
}

const MAX_TRACKED_ACCOUNTS = 10_000

function keyOf(email: string): string {
  // 邮箱大小写不敏感（见 users 路由的规范化），这里保持同一键
  return email.trim().toLowerCase()
}

/** 该账号当前是否处于封禁期；是则返回剩余毫秒数 */
export function blockedFor(email: string, now = Date.now()): number | null {
  const state = attempts.get(keyOf(email))
  if (!state) return null
  if (state.blockedUntil <= now) return null
  return state.blockedUntil - now
}

/** 记一次失败，并按次数指数延长封禁期 */
export function recordFailure(email: string, now = Date.now()): void {
  // 简单防内存膨胀：超出容量时清掉已过期与最旧的条目（个人实例实际到不了这个量级）
  if (attempts.size >= MAX_TRACKED_ACCOUNTS) {
    const nowMs = now
    for (const [k, v] of attempts) {
      if (v.blockedUntil <= nowMs) attempts.delete(k)
    }
    if (attempts.size >= MAX_TRACKED_ACCOUNTS) attempts.clear()
  }
  const key = keyOf(email)
  const state = attempts.get(key) ?? { failures: 0, blockedUntil: 0 }
  state.failures += 1
  // 第 1 次失败不封锁（正常的手误不该立刻被限流），第 2 次起指数退避
  if (state.failures >= 2) {
    state.blockedUntil = now + backoffDelay(state.failures)
  }
  attempts.set(key, state)
}

/** 登录成功：清空该账号的失败记录 */
export function clearFailures(email: string): void {
  attempts.delete(keyOf(email))
}

/** 仅测试使用 */
export function resetBackoff(): void {
  attempts.clear()
}
