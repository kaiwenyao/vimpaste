/**
 * 收藏夹与标签路由测试（plan-v2-accounts.md Phase 3）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createUserAndLogin,
  databaseAvailable,
  setupTestContext,
  truncateAll,
  type TestContext,
} from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('Collections & Tags', () => {
  const ctx: TestContext = setupTestContext()
  let alice: Awaited<ReturnType<typeof createUserAndLogin>>

  beforeEach(async () => {
    await truncateAll(ctx.prisma)
    alice = await createUserAndLogin(ctx, 'alice@example.com')
  })

  it('GET 列表在没有任何收藏夹时懒创建 default，且幂等', async () => {
    const first = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    expect(first.statusCode).toBe(200)
    const rows = first.json().data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'default' })

    // 再次 GET 不重复创建
    const second = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    expect(second.json().data).toHaveLength(1)
    expect(second.json().data[0].id).toBe(rows[0].id)

    // 删掉 default 后回到空状态：下次 GET 重新获得默认收藏夹
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/collections/${rows[0].id}`,
      headers: { cookie: alice.cookie },
    })
    expect(del.statusCode).toBe(200)
    const third = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    const recreated = third.json().data
    expect(recreated).toHaveLength(1)
    expect(recreated[0]).toMatchObject({ name: 'default' })
    expect(recreated[0].id).not.toBe(rows[0].id)
  })

  it('收藏夹 CRUD：创建、重名 409、更新、删除', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: '运维常用', color: '#c96442', order: 1 },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id

    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: '运维常用' },
    })
    expect(dup.statusCode).toBe(409)

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/collections/${id}`,
      headers: { cookie: alice.cookie },
      payload: { name: '运维', order: 2 },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().data).toMatchObject({ name: '运维', order: 2 })

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      headers: { cookie: alice.cookie },
    })
    expect(del.statusCode).toBe(200)
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    // 自建的收藏夹删掉了，只剩懒创建的 default
    expect(list.json().data).toHaveLength(1)
    expect(list.json().data[0].name).toBe('default')
  })

  it('PATCH 支持只改颜色 / 只改排序，列表按 (order, id) 返回', async () => {
    const make = async (name: string) => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { cookie: alice.cookie },
        payload: { name },
      })
      return res.json().data.id as number
    }
    const first = await make('A')
    const second = await make('B')

    // 前端「改颜色」只发 color（省略 name 不得被当作清空）
    const patchColor = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/collections/${first}`,
      headers: { cookie: alice.cookie },
      payload: { color: '#7d9463' },
    })
    expect(patchColor.statusCode).toBe(200)
    expect(patchColor.json().data).toMatchObject({ name: 'A', color: '#7d9463' })

    // 非法色值必须拒绝：前端调色板只会发 #RRGGBB
    const badColor = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/collections/${first}`,
      headers: { cookie: alice.cookie },
      payload: { color: '#abc' },
    })
    expect(badColor.statusCode).toBe(400)

    // 前端「下移」＝ 两条换序：B 排到 A 前面
    for (const [id, order] of [
      [second, 0],
      [first, 1],
    ] as const) {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/collections/${id}`,
        headers: { cookie: alice.cookie },
        payload: { order },
      })
      expect(res.statusCode).toBe(200)
    }
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    // B 排到 A 前面（列表只按 order 返回；此处没走过空的 GET，因此没有懒创建 default）
    expect(list.json().data.map((c: { name: string }) => c.name)).toEqual(['B', 'A'])
  })

  it('删除收藏夹时条目保留（collectionId 置空，SetNull）', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: '临时' },
    })
    const colId = created.json().data.id
    const now = Date.now()
    await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets',
      headers: { cookie: alice.cookie },
      payload: {
        id: '00000000-0000-4000-8000-000000000009',
        kind: 'command',
        title: 't',
        content: 'echo hi',
        langId: 'shell',
        pinned: false,
        usageCount: 0,
        lastUsedAt: null,
        collectionId: colId,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    })
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/collections/${colId}`,
      headers: { cookie: alice.cookie },
    })
    const snippet = await ctx.prisma.snippet.findUniqueOrThrow({
      where: { id: '00000000-0000-4000-8000-000000000009' },
    })
    expect(snippet.collectionId).toBeNull()
  })

  it('A 用户的收藏夹对 B 不可见、不可改、不可删', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: 'Alice 的收藏夹' },
    })
    const id = created.json().data.id
    const bob = await createUserAndLogin(ctx, 'bob@example.com')

    // B 只看得到自己的 default，看不到 A 的收藏夹
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: bob.cookie },
    })
    const bobNames = list.json().data.map((c: { name: string }) => c.name)
    expect(bobNames).toEqual(['default'])

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/collections/${id}`,
      headers: { cookie: bob.cookie },
      payload: { name: '劫持' },
    })
    expect(patch.statusCode).toBe(404)

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      headers: { cookie: bob.cookie },
    })
    expect(del.statusCode).toBe(404)
  })

  it('无 body 的 DELETE 带 Content-Type: application/json 也成功（浏览器 fetch 的真实行为）', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      payload: { name: '待删除' },
    })
    const id = created.json().data.id
    // 回归：前端 fetch 客户端曾对无 body 的 DELETE 一律声明 application/json，
    // 默认解析器按空 JSON 解析直接抛 400「请求无法处理」，删除收藏夹全部失败
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
    })
    expect(del.statusCode).toBe(200)
    expect(del.json().data).toMatchObject({ id, deleted: true })

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
    })
    expect(list.json().data.map((c: { name: string }) => c.name)).toEqual(['default'])
  })

  it('坏 JSON 仍按 400「请求无法处理」拒绝（空 body 容忍不放过坏数据）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      payload: '{not-json',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', message: '请求无法处理' })
  })
})
