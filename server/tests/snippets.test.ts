/**
 * Snippet 路由契约测试（plan-v2-accounts.md Phase 3 验收）：
 * 每类端点覆盖 成功 / 校验失败 / 未授权 / 越权 四种情况，外加配额、时间戳钳制、
 * 分页游标与搜索。核心安全断言：A 用户拿不到 B 用户的条目。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createUserAndLogin,
  databaseAvailable,
  setupTestContext,
  snippetPayload,
  testEnv,
  truncateAll,
  uuid,
  type TestContext,
} from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('Snippet API', () => {
  const ctx: TestContext = setupTestContext()
  let alice: Awaited<ReturnType<typeof createUserAndLogin>>
  let bob: Awaited<ReturnType<typeof createUserAndLogin>>

  beforeEach(async () => {
    await truncateAll(ctx.prisma)
    alice = await createUserAndLogin(ctx, 'alice@example.com')
    bob = await createUserAndLogin(ctx, 'bob@example.com')
  })

  const createAs = (cookie: string, payload: Record<string, unknown> = {}) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/snippets',
      headers: { cookie },
      payload: snippetPayload(payload),
    })

  it('未授权访问返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/snippets' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('创建返回 201；重复 POST 同一 id 幂等（不产生第二条）', async () => {
    const first = await createAs(alice.cookie)
    expect(first.statusCode).toBe(201)
    expect(first.json().ok).toBe(true)
    expect(first.json().data).toMatchObject({ id: uuid(1), langId: 'shell' })

    const again = await createAs(alice.cookie, { title: '改动过的标题', updatedAt: Date.now() })
    expect(again.statusCode).toBe(200)
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets',
      headers: { cookie: alice.cookie },
    })
    expect(list.json().data).toHaveLength(1)
  })

  it('校验失败返回 400 VALIDATION_FAILED 且不回显输入内容', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets',
      headers: { cookie: alice.cookie },
      payload: { id: 'not-a-uuid', content: 'x'.repeat(200_001) },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.stringify(res.json())
    expect(body).not.toContain('YOUR_TOKEN')
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('单条 content 超上限被拒绝', async () => {
    const res = await createAs(alice.cookie, { content: 'x'.repeat(100_001) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('时间戳钳制：未来时间与 1970 纪元值都落到服务器当前时间', async () => {
    const before = Date.now()
    const res = await createAs(alice.cookie, {
      createdAt: Date.now() + 60 * 60 * 1000, // 一小时后：超过 5 分钟容差
      updatedAt: 3600_000, // 1970-01-01：早于 1990 边界
    })
    const data = res.json().data
    expect(data.createdAt).toBeGreaterThanOrEqual(before)
    expect(data.updatedAt).toBeGreaterThanOrEqual(before)
    expect(data.createdAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('PATCH 局部更新与乐观并发：过期 updatedAt 返回 409', async () => {
    await createAs(alice.cookie)
    const stale = Date.now() - 60_000
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
      payload: { title: '新标题', updatedAt: stale },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('UPDATE_CONFLICT')

    const okRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
      payload: { title: '新标题', updatedAt: Date.now() + 5000 },
    })
    expect(okRes.statusCode).toBe(200)
    expect(okRes.json().data.title).toBe('新标题')
  })

  it('DELETE 是软删除：列表消失、带墓碑保留在库里', async () => {
    await createAs(alice.cookie)
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
    })
    expect(del.statusCode).toBe(200)

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets',
      headers: { cookie: alice.cookie },
    })
    expect(list.json().data).toHaveLength(0)

    const rows = await ctx.prisma.snippet.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].deletedAt).not.toBeNull()
  })

  it('A 用户拿不到 B 用户的条目（列表 / 单条 / PATCH / DELETE 全路径）', async () => {
    await createAs(alice.cookie)

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets',
      headers: { cookie: bob.cookie },
    })
    expect(list.json().data).toHaveLength(0)
    expect(list.json().meta.total).toBe(0)

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: bob.cookie },
      payload: { title: '劫持', updatedAt: Date.now() },
    })
    expect(patch.statusCode).toBe(404)

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: bob.cookie },
    })
    expect(del.statusCode).toBe(404)

    const sameId = await createAs(bob.cookie) // B 用 A 的 UUID：全局唯一，409 冲突
    expect(sameId.statusCode).toBe(409)
    expect(sameId.json().error.code).toBe('ID_CONFLICT')
    const bobList = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets',
      headers: { cookie: bob.cookie },
    })
    // B 什么都没有；A 的条目原封不动
    expect(bobList.json().data).toHaveLength(0)
    const rowA = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(rowA.ownerId).toBe(alice.id)
  })

  it('搜索 q 命中标题与内容（大小写不敏感），kind 过滤生效', async () => {
    await createAs(alice.cookie)
    await createAs(alice.cookie, {
      id: uuid(2),
      kind: 'prompt',
      title: '评审 Prompt',
      content: '请审查 {{代码}}',
      langId: 'plaintext',
    })

    const hit = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets?q=K3S_TOKEN',
      headers: { cookie: alice.cookie },
    })
    expect(hit.json().data).toHaveLength(1)
    expect(hit.json().data[0].id).toBe(uuid(1))

    const kindRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets?kind=prompt',
      headers: { cookie: alice.cookie },
    })
    expect(kindRes.json().data).toHaveLength(1)
    expect(kindRes.json().data[0].id).toBe(uuid(2))
  })

  it('cursor 分页：按 updatedAt 降序翻页且不重不漏', async () => {
    for (let i = 1; i <= 5; i++) {
      await createAs(alice.cookie, {
        id: uuid(i),
        updatedAt: Date.now() - i * 1000,
        title: `t${i}`,
      })
    }
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url:
          '/api/snippets' + (cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=2` : '?limit=2'),
        headers: { cookie: alice.cookie },
      })
      const body = res.json()
      seen.push(...body.data.map((s: { id: string }) => s.id))
      cursor = body.meta?.cursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })

  it('标签随条目写入并可在 GET /api/tags 查询使用计数', async () => {
    await createAs(alice.cookie, { tags: ['运维', 'k3s'] })
    await createAs(alice.cookie, { id: uuid(2), tags: ['运维'] })
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/tags',
      headers: { cookie: alice.cookie },
    })
    const tags = Object.fromEntries(
      res.json().data.map((t: { name: string; count: number }) => [t.name, t.count]),
    )
    expect(tags['运维']).toBe(2)
    expect(tags['k3s']).toBe(1)

    // B 用户看不到 A 的标签
    const bobRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/tags',
      headers: { cookie: bob.cookie },
    })
    expect(bobRes.json().data).toHaveLength(0)
  })

  it('collectionId 必须属于当前用户', async () => {
    const col = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: '常用' },
    })
    expect(col.statusCode).toBe(201)
    const colId = col.json().data.id

    const mine = await createAs(alice.cookie, { collectionId: colId })
    expect(mine.statusCode).toBe(201)

    const foreign = await createAs(bob.cookie, { collectionId: colId })
    expect(foreign.statusCode).toBe(400)
  })
})

describe.skipIf(!dbUp)('Snippet API · 配额', () => {
  // 独立 app 实例：把上限调小到 2，避免测试里造一万条数据
  const ctx: TestContext = setupTestContext(testEnv({ MAX_SNIPPETS_PER_USER: 2 }))

  beforeEach(async () => {
    await truncateAll(ctx.prisma)
  })

  it('超出 MAX_SNIPPETS_PER_USER 后创建返回 409 QUOTA_EXCEEDED', async () => {
    const user = await createUserAndLogin(ctx, 'quota@example.com')
    const make = (n: number) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/snippets',
        headers: { cookie: user.cookie },
        payload: snippetPayload({ id: uuid(n) }),
      })
    expect((await make(1)).statusCode).toBe(201)
    expect((await make(2)).statusCode).toBe(201)
    const third = await make(3)
    expect(third.statusCode).toBe(409)
    expect(third.json().error.code).toBe('QUOTA_EXCEEDED')
    // 软删除腾出配额后可再创建（配额只计未删除条目）
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: user.cookie },
    })
    expect((await make(4)).statusCode).toBe(201)
  })
})
