/**
 * 密码哈希：argon2id（plan-v2-accounts.md Phase 2）。
 *
 * 参数取 OWASP Password Storage Cheat Sheet 的推荐底线（2024 起建议的最低配置）：
 *   memoryCost = 19456 KiB（19 MiB）、timeCost = 2、parallelism = 1。
 * 这是「每次验证 ~50ms / ~20MB 内存」的折中：单实例低并发场景足以抵御 GPU 离线爆破，
 * 又不会让登录请求在 2C4G 的家用集群节点上明显变慢。参数写死为常量并随代码演进，
 * hash 串自带参数，未来调高不影响旧哈希验证。
 */
import { Algorithm, hash, verify } from '@node-rs/argon2'

export const ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS)
}

/** 验证失败（哈希格式损坏等）一律返回 false，不向调用方抛错 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_PARAMS)
  } catch {
    return false
  }
}
