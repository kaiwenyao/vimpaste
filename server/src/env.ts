/**
 * 环境变量 schema 校验（plan-v2-accounts.md §11）：
 * 启动时一次性解析，缺失或非法立即退出——不允许运行时才炸。
 */
import { z } from 'zod'

/**
 * 布尔环境变量：只接受 "true"/"false" 字面量与布尔值，
 * 避免 coerce.boolean 把 "false" 当真；其余值原样传给内层 schema 报错。
 */
const booleanString = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === 'true' || v === true) return true
    if (v === 'false' || v === false) return false
    return undefined
  }, z.boolean().default(defaultValue))

const EnvSchema = z.object({
  /** Postgres 连接串 */
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL 必须是 postgres:// 连接串',
    }),
  /** ≥ 32 字节随机值：与会话令牌做 HMAC，数据库单独泄露时令牌哈希不可反推 */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 至少 32 字符（建议 openssl rand -base64 32）'),
  /** 注册开关：默认关闭，单人自托管用 create-user CLI 建账号 */
  DISABLE_REGISTRATION: booleanString(true),
  MAX_SNIPPETS_PER_USER: z.coerce.number().int().min(1).max(1_000_000).default(10_000),
  MAX_CONTENT_CHARS: z.coerce.number().int().min(1000).max(1_000_000).default(100_000),
  /** 软删除墓碑保留天数：超过后由定时任务硬删 */
  TOMBSTONE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** 信任反向代理（nginx / k3s ingress）的 X-Forwarded-* 头，用于取真实客户端 IP */
  TRUST_PROXY: booleanString(true),
})

export type Env = z.infer<typeof EnvSchema>

/** 解析失败时的可读报告：只报字段与原因，不回显值（连接串里可能有密码） */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const message = `环境变量校验失败，服务拒绝启动：\n${formatEnvIssues(parsed.error)}`
    throw new Error(message)
  }
  return parsed.data
}
