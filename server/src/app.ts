/**
 * Fastify 应用组装（plan-v2-accounts.md §4.1）：插件、钩子、错误处理与路由注册。
 * buildApp 同时服务于生产启动（index.ts）与集成测试（tests 里用 fastify.inject）。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { PrismaClient } from '@prisma/client'
import { ZodError } from 'zod'
import type { Env } from './env.js'
import { ApiError } from './envelope.js'
import { registerSecurityHooks } from './auth/plugin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSnippetRoutes } from './routes/snippets.js'
import { registerCollectionRoutes } from './routes/collections.js'
import { registerTagRoutes } from './routes/tagList.js'
import { registerHealthRoutes } from './routes/health.js'

/** 请求体上限 2 MB（plan-v2-accounts.md §6） */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024

/** /api/auth/register|login 限流：5 次/分钟/IP */
export const AUTH_RATE_LIMIT = { max: 5, timeWindow: '1 minute' } as const

export interface AppOptions {
  env: Env
  prisma: PrismaClient
  /** 测试注入：覆盖默认的 stdout 日志 */
  loggerStream?: NodeJS.WritableStream
  /** 测试注入：覆盖默认日志级别 */
  logLevel?: string
  /** 测试注入：覆盖 /api/auth 限流配置（默认 5 次/分钟/IP） */
  authRateLimit?: { max: number; timeWindow: string }
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { env, prisma } = options

  // 日志红线（§10 风险 2）：编辑内容与凭据绝不进日志；
  // 集成测试会断言日志流中不出现请求体 content。
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: options.logLevel ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info'),
      redact: {
        paths: [
          'req.headers.cookie',
          'req.body.content',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
  })

  await app.register(cookie)
  await app.register(rateLimit, { global: false })

  registerSecurityHooks(app, prisma, env.SESSION_SECRET)

  // 统一错误信封：zod 校验失败 → 400（只回字段路径，不回显输入）；
  // ApiError → 携带状态码与业务码；其余 → 500（原始错误只进日志）。
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const fields = error.issues.map((i) => i.path.join('.')).filter(Boolean)
      void reply.code(400).send({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: fields.length > 0 ? `字段校验失败：${fields.join(', ')}` : '请求体校验失败',
        },
      })
      return reply
    }
    if (error instanceof ApiError) {
      void reply.code(error.statusCode).send({
        ok: false,
        error: { code: error.code, message: error.message },
      })
      return reply
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (typeof statusCode === 'number') {
      // Fastify 内置错误（解析失败 / 超限）：不透出原始 message，统一归为请求无法处理
      void reply.code(statusCode >= 400 && statusCode < 500 ? statusCode : 500).send({
        ok: false,
        error: {
          code:
            statusCode === 413
              ? 'PAYLOAD_TOO_LARGE'
              : statusCode === 429
                ? 'TOO_MANY_REQUESTS'
                : 'BAD_REQUEST',
          message:
            statusCode === 413
              ? '请求体过大'
              : statusCode === 429
                ? '请求过于频繁，请稍后再试'
                : '请求无法处理',
        },
      })
      return reply
    }
    request.log.error(error)
    void reply.code(500).send({
      ok: false,
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    })
    return reply
  })

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  app.register(async (scope) => registerAuthRoutes(scope, prisma, env, options.authRateLimit), {
    prefix: '/api/auth',
  })
  app.register(async (scope) => registerSnippetRoutes(scope, prisma, env), {
    prefix: '/api/snippets',
  })
  app.register(async (scope) => registerCollectionRoutes(scope, prisma), {
    prefix: '/api/collections',
  })
  app.register(async (scope) => registerTagRoutes(scope, prisma), { prefix: '/api/tags' })
  app.register(async (scope) => registerHealthRoutes(scope, prisma), { prefix: '/api' })

  await app.ready()
  return app
}
