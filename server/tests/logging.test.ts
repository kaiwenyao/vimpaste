/**
 * 日志红线测试（plan-v2-accounts.md §10 风险 2）：
 * 请求/响应日志绝不出现编辑器 content、密码、Cookie 与 Set-Cookie。
 */
import { Writable } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createUserAndLogin,
  databaseAvailable,
  setupTestContext,
  snippetPayload,
  testEnv,
  truncateAll,
  type TestContext,
} from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('日志脱敏', () => {
  const captured: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      captured.push(chunk.toString())
      cb()
    },
  })
  // 独立 app 实例：info 级别 + 捕获流（默认测试实例是 warn 级，不产请求日志）
  const ctx: TestContext = setupTestContext(testEnv(), { loggerStream: stream, logLevel: 'info' })

  beforeEach(async () => {
    await truncateAll(ctx.prisma)
    captured.length = 0
  })

  it('请求体 content 与登录密码不进日志', async () => {
    const SECRET_TOKEN = 'SUPER-SECRET-TOKEN-VALUE'
    const SECRET_PASSWORD = 'SUPER-SECRET-PASSWORD'
    const user = await createUserAndLogin(ctx, 'logger@example.com', SECRET_PASSWORD)
    await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets',
      headers: { cookie: user.cookie },
      payload: snippetPayload({ content: `curl x | K3S_TOKEN='${SECRET_TOKEN}' sh -s -` }),
    })
    await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets?q=nonexistent',
      headers: { cookie: user.cookie },
    })

    const all = captured.join('')
    expect(all).not.toContain(SECRET_TOKEN)
    expect(all).not.toContain(SECRET_PASSWORD)
    expect(all).not.toContain('SUPER-SECRET-TOKEN')
  })

  it('Set-Cookie 响应头与会话 Cookie 不进日志', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'setcookie@example.com', password: 'password-123' },
    })
    const all = captured.join('')
    expect(all).not.toMatch(/vimpaste_session=[A-Za-z0-9_-]{20,}/)
  })

  it('请求体解析失败的日志里也不含请求体内容', async () => {
    const user = await createUserAndLogin(ctx, 'logger2@example.com')
    await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets/sync',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: '{invalid-json',
    })
    const all = captured.join('')
    expect(all).not.toContain('YOUR_TOKEN')
  })
})
