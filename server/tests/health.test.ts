/**
 * 探针集成测试：healthz 不查库恒 200；readyz 查库。
 */
import { describe, expect, it } from 'vitest'
import { databaseAvailable, setupTestContext, type TestContext } from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('探针', () => {
  const ctx: TestContext = setupTestContext()

  it('GET /api/healthz 返回 200 且不依赖数据库', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, data: { status: 'ok' } })
  })

  it('GET /api/readyz 数据库可达时 200', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('ready')
  })

  it('未知 /api 路径返回信封 404', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})
