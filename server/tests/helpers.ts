/**
 * 集成测试基建：连接测试库、构建 app、按用户登录拿 Cookie。
 * 需要 TEST_DATABASE_URL（或默认 localhost:5432/vimpaste_test）；
 * 环境不可达时整组跳过（CI 里由 postgres 服务容器提供）。
 */
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import type { Env } from '../src/env.js'
import { hashPassword } from '../src/auth/password.js'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://vimpaste:vimpaste@localhost:5432/vimpaste_test'

export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: TEST_SECRET,
    DISABLE_REGISTRATION: true,
    MAX_SNIPPETS_PER_USER: 10_000,
    MAX_CONTENT_CHARS: 100_000,
    TOMBSTONE_RETENTION_DAYS: 30,
    PORT: 3000,
    TRUST_PROXY: true,
    ...overrides,
  }
}

export interface TestContext {
  prisma: PrismaClient
  app: FastifyInstance
}

let ctx: TestContext | null = null

/** 探测测试库是否可达（不可达则跳过整组用例） */
export async function databaseAvailable(): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  })
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await prisma.$disconnect()
  }
}

export function setupTestContext(
  env: Env = testEnv(),
  options: {
    loggerStream?: NodeJS.WritableStream
    logLevel?: string
    /** 集成测试默认放宽限流；限流用例用真实配置自建实例 */
    authRateLimit?: { max: number; timeWindow: string }
  } = {},
): TestContext {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  })

  let app: FastifyInstance | null = null

  beforeAll(async () => {
    app = await buildApp({
      env,
      prisma,
      loggerStream: options.loggerStream,
      logLevel: options.logLevel,
      // 默认放宽到 1000 次/分钟：单个 app 实例上的登录调用远多于 5 次/分钟；
      // 限流本身的行为由 auth.test.ts 中的专用实例（authRateLimit: undefined）验证
      authRateLimit: options.authRateLimit ?? { max: 1000, timeWindow: '1 minute' },
    })
  })

  afterAll(async () => {
    await app?.close()
    await prisma.$disconnect()
  })

  ctx = {
    prisma,
    get app(): FastifyInstance {
      if (!app) throw new Error('app 尚未初始化')
      return app
    },
  }
  return ctx
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Snippet", "Tag", "Collection", "Session", "User" CASCADE',
  )
}

export interface TestUser {
  id: number
  email: string
  cookie: string
}

/** 直接在库里建用户（绕过注册开关），然后走 /login 拿会话 Cookie */
export async function createUserAndLogin(
  context: TestContext,
  email: string,
  password = 'password-123',
): Promise<TestUser> {
  const user = await context.prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  })
  const res = await context.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  if (res.statusCode !== 200) {
    throw new Error(`登录失败：${res.statusCode} ${res.body}`)
  }
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return { id: user.id, email, cookie }
}

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function snippetPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now()
  return {
    id: uuid(1),
    kind: 'command',
    title: 'curl 命令',
    content: "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -",
    langId: 'shell',
    pinned: false,
    usageCount: 0,
    lastUsedAt: null,
    collectionId: null,
    tags: [],
    createdAt: now - 1000,
    updatedAt: now,
    ...overrides,
  }
}
