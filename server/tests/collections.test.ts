/**
 * 集合与标签路由测试（plan-v2-accounts.md Phase 3）。
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

  it('集合 CRUD：创建、重名 409、更新、删除', async () => {
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
    expect(list.json().data).toHaveLength(0)
  })

  it('删除集合时条目保留（collectionId 置空，SetNull）', async () => {
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

  it('A 用户的集合对 B 不可见、不可改、不可删', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie: alice.cookie },
      payload: { name: 'Alice 的集合' },
    })
    const id = created.json().data.id
    const bob = await createUserAndLogin(ctx, 'bob@example.com')

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: bob.cookie },
    })
    expect(list.json().data).toHaveLength(0)

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
})
