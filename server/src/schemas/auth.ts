/** 认证相关请求体 schema */
import { z } from 'zod'

export const authCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** 最低 8 位：单人自托管场景下可用性优先，其余强度交给 argon2 与按账号退避 */
  password: z.string().min(8).max(1024),
  name: z.string().trim().min(1).max(64).optional(),
})
