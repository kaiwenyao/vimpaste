/**
 * 安全与认证插件：
 * - Origin 校验：所有非幂等 /api 请求，带 Origin 头但与 Host 不一致的一律 403。
 *   这是 CSRF 的第二道防线（第一道是 SameSite=Strict Cookie）——跨站请求伪造出来的
 *   fetch 必然带着攻击者站点的 Origin，对不上就拒绝；无 Origin 的非浏览器客户端不受影响。
 * - requireAuth：解析会话 Cookie 并把 user/session 挂到请求上，未认证返回 401。
 *   所有 /api/snippets|collections|tags 路由都必须挂它，ownerId 一律取自会话。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { fail } from '../envelope.js'
import { resolveSession, setSessionCookie } from './session.js'
import type { PrismaClient } from '@prisma/client'

/** 判定 Origin 与请求 Host 是否同源；X-Forwarded-Host 优先（nginx 反代场景） */
export function originMatchesHost(
  origin: string,
  hostHeader: string | string[] | undefined,
): boolean {
  if (!hostHeader) return false
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  if (!host) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  return originHost === host
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

export function registerSecurityHooks(
  app: FastifyInstance,
  prisma: PrismaClient,
  sessionSecret: string,
): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/') || isSafeMethod(request.method)) return
    const origin = request.headers.origin
    if (!origin) return // 非浏览器客户端（curl / 服务间调用）不带 Origin，交由会话与限流兜底
    const host = request.headers['x-forwarded-host'] ?? request.headers.host
    if (!originMatchesHost(origin, host)) {
      void reply.code(403).send(fail(403, 'FORBIDDEN_ORIGIN', 'Origin 校验失败'))
    }
  })

  /** 命中滑动续期时在响应前重发 Cookie */
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.sessionRenewed) {
      const token = request.cookies['vimpaste_session']
      if (token) setSessionCookie(reply, token)
    }
  })

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = await resolveSession(prisma, request, sessionSecret)
    if (!resolved) {
      void reply.code(401).send(fail(401, 'UNAUTHORIZED', '请先登录'))
      return
    }
    request.user = resolved.user
    request.session = resolved.session
    if (resolved.renewed) request.sessionRenewed = true
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
