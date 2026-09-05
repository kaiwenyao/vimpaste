/**
 * 认证路由（plan-v2-accounts.md §6）：register / login / logout / me。
 * 安全约束：
 * - /api/auth/* 全局限流 5 次/分钟/IP（@fastify/rate-limit，在 app.ts 挂载）；
 * - 登录失败按账号指数退避（backoff.ts）；
 * - 登录失败统一返回「邮箱或密码错误」，不泄露账号是否存在。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { ApiError, fail, ok } from '../envelope.js'
import type { Env } from '../env.js'
import { authCredentialsSchema } from '../schemas/auth.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { clearFailures, blockedFor, recordFailure } from '../auth/backoff.js'
import {
  clearSessionCookie,
  createSession,
  resolveSession,
  setSessionCookie,
  toAuthedUser,
} from '../auth/session.js'

/** register/login 的限流配置（生产默认 5 次/分钟/IP，测试可放宽） */
export interface RateLimitConfig {
  max: number
  timeWindow: string
}

const DEFAULT_AUTH_RATE_LIMIT: RateLimitConfig = { max: 5, timeWindow: '1 minute' }

export function registerAuthRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Env,
  rateLimit: RateLimitConfig = DEFAULT_AUTH_RATE_LIMIT,
): void {
  app.post(
    '/register',
    { config: { rateLimit } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (env.DISABLE_REGISTRATION) {
        throw fail(403, 'REGISTRATION_DISABLED', '注册已关闭，请联系管理员创建账号')
      }
      const body = authCredentialsSchema.parse(request.body)
      const existing = await prisma.user.findUnique({ where: { email: body.email } })
      if (existing) {
        throw fail(409, 'EMAIL_TAKEN', '该邮箱已注册')
      }
      const user = await prisma.user.create({
        data: {
          email: body.email,
          name: body.name ?? null,
          passwordHash: await hashPassword(body.password),
        },
      })
      const { token } = await createSession(prisma, user.id, request.headers['user-agent'])
      setSessionCookie(reply, token)
      return reply.code(201).send(ok({ user: toAuthedUser(user) }))
    },
  )

  app.post(
    '/login',
    { config: { rateLimit } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = authCredentialsSchema.safeParse(request.body)
      // 请求体非法时不区分「邮箱不存在」与「密码错误」，统一走登录失败路径
      if (!parsed.success) {
        throw fail(401, 'AUTH_FAILED', '邮箱或密码错误')
      }
      const { email, password } = parsed.data

      const blockedMs = blockedFor(email)
      if (blockedMs !== null) {
        throw new ApiError(
          429,
          'TOO_MANY_ATTEMPTS',
          `尝试过于频繁，请 ${Math.ceil(blockedMs / 1000)} 秒后重试`,
        )
      }

      const user = await prisma.user.findUnique({ where: { email } })
      const passwordOk = user ? await verifyPassword(user.passwordHash, password) : false
      if (!user || !passwordOk) {
        // 统一 401 文案，不泄露账号是否存在；账号维度再叠加指数退避（backoff.ts）
        recordFailure(email)
        throw fail(401, 'AUTH_FAILED', '邮箱或密码错误')
      }
      clearFailures(email)
      const { token } = await createSession(prisma, user.id, request.headers['user-agent'])
      setSessionCookie(reply, token)
      return { ok: true as const, data: { user: toAuthedUser(user) } }
    },
  )

  app.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = await resolveSession(prisma, request)
    if (resolved) {
      await prisma.session.delete({ where: { id: resolved.session.id } }).catch(() => undefined)
    }
    clearSessionCookie(reply)
    return { ok: true as const, data: { loggedOut: true } }
  })

  app.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = await resolveSession(prisma, request)
    if (!resolved) {
      void reply.code(401)
      throw fail(401, 'UNAUTHORIZED', '未登录')
    }
    if (resolved.renewed) request.sessionRenewed = true
    return { ok: true as const, data: { user: resolved.user } }
  })
}
