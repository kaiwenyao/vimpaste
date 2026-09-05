/**
 * 认证集成测试（plan-v2-accounts.md Phase 2 验收）：
 * 注册关闭时 403、错密码不泄露账号是否存在、会话过期后 401、限流生效、Origin 校验。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildApp } from '../src/app.js'
import {
  TEST_DATABASE_URL,
  createUserAndLogin,
  databaseAvailable,
  setupTestContext,
  testEnv,
  truncateAll,
  type TestContext,
} from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('认证', () => {
  describe('默认配置（注册关闭）', () => {
    const ctx: TestContext = setupTestContext()

    beforeEach(async () => {
      await truncateAll(ctx.prisma)
    })

    it('注册被禁用时返回 403 REGISTRATION_DISABLED', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'new@example.com', password: 'password-123' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ ok: false, error: { code: 'REGISTRATION_DISABLED' } })
    })

    it('登录成功下发 httpOnly 会话 Cookie，/me 返回用户', async () => {
      const user = await createUserAndLogin(ctx, 'me@example.com')
      expect(user.cookie).toMatch(/vimpaste_session=/)
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: user.cookie },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.user).toMatchObject({ email: 'me@example.com' })
    })

    it('Cookie 属性为 httpOnly + SameSite=Strict + Secure（同源方案的前提）', async () => {
      await createUserAndLogin(ctx, 'cookie@example.com')
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'cookie@example.com', password: 'password-123' },
      })
      expect(res.statusCode).toBe(200)
      const setCookie = res.headers['set-cookie']
      const header = Array.isArray(setCookie) ? setCookie.join('') : String(setCookie)
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
      expect(header).toContain('SameSite=Strict')
      expect(header).toContain('Path=/')
    })

    it('错密码与不存在账号返回同一文案（不泄露账号是否存在）', async () => {
      await createUserAndLogin(ctx, 'real@example.com')
      for (const payload of [
        { email: 'real@example.com', password: 'wrong-password' },
        { email: 'ghost@example.com', password: 'wrong-password' },
      ]) {
        const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload })
        expect(res.statusCode).toBe(401)
        expect(res.json().error).toMatchObject({ code: 'AUTH_FAILED', message: '邮箱或密码错误' })
      }
    })

    it('请求体非法（密码过短）也是统一 401 文案', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'a@b.co', password: 'short' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.message).toBe('邮箱或密码错误')
    })

    it('logout 吊销会话：之后 /me 返回 401', async () => {
      const user = await createUserAndLogin(ctx, 'bye@example.com')
      const out = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: user.cookie },
      })
      expect(out.statusCode).toBe(200)
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: user.cookie },
      })
      expect(res.statusCode).toBe(401)
    })

    it('会话过期后 401（数据库里的过期会话被清除）', async () => {
      const user = await createUserAndLogin(ctx, 'expired@example.com')
      await ctx.prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: user.cookie },
      })
      expect(res.statusCode).toBe(401)
      const remaining = await ctx.prisma.session.count()
      expect(remaining).toBe(0)
    })

    it('登录失败按账号指数退避：连续失败后 429', async () => {
      const email = 'backoff@example.com'
      for (let i = 0; i < 3; i++) {
        await ctx.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'wrong-password' },
        })
      }
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'wrong-password' },
      })
      expect(res.statusCode).toBe(429)
      expect(res.json().error.code).toBe('TOO_MANY_ATTEMPTS')
    })

    it('登录成功后失败计数清零，可正常再次登录', async () => {
      const user = await createUserAndLogin(ctx, 'recover@example.com')
      // 先失败一次（累计退避），再用正确密码成功登录
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'wrong-password' },
      })
      const okRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'password-123' },
      })
      expect(okRes.statusCode).toBe(200)
      // 成功后计数清零：连续失败只会从第 1 次重新起算，仍返回 401 而不是 429
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'wrong-password' },
      })
      const again = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'wrong-password' },
      })
      expect(again.statusCode).toBe(401)
    })
  })

  describe('开放注册（DISABLE_REGISTRATION=false）', () => {
    const ctx: TestContext = setupTestContext(testEnv({ DISABLE_REGISTRATION: false }))

    beforeEach(async () => {
      await truncateAll(ctx.prisma)
    })

    it('注册成功返回 201 并直接建立会话', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'first@example.com', password: 'password-123', name: 'First' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().data.user).toMatchObject({ email: 'first@example.com', name: 'First' })
      const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const me = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      })
      expect(me.statusCode).toBe(200)
    })

    it('重复邮箱返回 409', async () => {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'dup@example.com', password: 'password-123' },
      })
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'dup@example.com', password: 'password-456' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('EMAIL_TAKEN')
    })

    it('同一 IP 超过 5 次/分钟后限流 429', async () => {
      // 专用实例：不放宽限流（其它用例共享的实例是放宽配置）
      const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } })
      const limited = await buildApp({
        env: testEnv({ DISABLE_REGISTRATION: false }),
        prisma,
      })
      try {
        for (let i = 0; i < 5; i++) {
          const res = await limited.inject({
            method: 'POST',
            url: '/api/auth/register',
            payload: { email: `limited${i}@example.com`, password: 'password-123' },
          })
          expect(res.statusCode).toBe(201)
        }
        const res = await limited.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { email: 'overflow@example.com', password: 'password-123' },
        })
        expect(res.statusCode).toBe(429)
        expect(res.json().error.code).toBe('TOO_MANY_REQUESTS')
      } finally {
        await limited.close()
        await prisma.$disconnect()
      }
    })
  })

  describe('Origin 校验（CSRF 第二道防线）', () => {
    const ctx: TestContext = setupTestContext()

    it('跨源 Origin 的写请求被 403 拒绝', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'https://evil.example', host: 'localhost:3000' },
        payload: { email: 'x@example.com', password: 'password-123' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN_ORIGIN')
    })

    it('同源 Origin 的写请求正常处理', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
        payload: { email: 'nobody@example.com', password: 'password-123' },
      })
      expect(res.statusCode).toBe(401) // 走到了登录逻辑（账号不存在），而不是 403
    })
  })
})
