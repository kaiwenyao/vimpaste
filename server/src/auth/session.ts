/**
 * 服务端会话（plan-v2-accounts.md Phase 2）：
 * - Cookie 里是 32 字节随机 token（base64url）；库里只存它的 SHA-256，可单条吊销；
 * - 30 天滑动过期：剩余不足一半（15 天）时在已认证请求中续期并重发 Cookie；
 * - Cookie 属性 httpOnly + Secure + SameSite=Strict + Path=/，
 *   配合同源部署（浏览器只访问 /api/）与 Origin 校验构成 CSRF 双保险。
 */
import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient, Session, User } from '@prisma/client'

export const SESSION_COOKIE = 'vimpaste_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 剩余寿命低于该值时触发滑动续期（TTL 的一半） */
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2

export interface AuthedUser {
  id: number
  email: string
  name: string | null
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CreateSessionResult {
  token: string
  session: Session
}

export async function createSession(
  prisma: PrismaClient,
  userId: number,
  userAgent: string | undefined,
  now = Date.now(),
): Promise<CreateSessionResult> {
  const token = generateSessionToken()
  const session = await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(now + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 256) ?? null,
    },
  })
  return { token, session }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

export interface ResolvedSession {
  user: AuthedUser
  session: Session
  /** 命中滑动续期：true 时调用方需要用原 token 重发 Cookie */
  renewed: boolean
}

/**
 * 从请求 Cookie 解析会话：无效 / 过期 / 已吊销一律返回 null。
 * 命中且剩余寿命不足一半时续期（滑动过期），并提示调用方重发 Cookie。
 */
export async function resolveSession(
  prisma: PrismaClient,
  request: FastifyRequest,
  now = Date.now(),
): Promise<ResolvedSession | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  let renewed = false
  if (session.expiresAt.getTime() - now < RENEW_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(now + SESSION_TTL_MS) },
      })
      .catch(() => undefined)
    renewed = true
  }
  return { user: toAuthedUser(session.user), session, renewed }
}

export function toAuthedUser(user: User): AuthedUser {
  return { id: user.id, email: user.email, name: user.name }
}

/** 已认证请求上附加的会话信息（由 requireAuth 预处理器写入） */
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser
    session?: Session
    /** requireAuth 命中滑动续期时置位，路由响应前统一重发 Cookie */
    sessionRenewed?: boolean
  }
}
