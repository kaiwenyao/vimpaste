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

  it('无 body 的 DELETE 带 Content-Type: application/json 也成功（浏览器 fetch 的真实行为）', async () => {
    await createAs(alice.cookie)
    // 与收藏夹删除同一回归：无 body 的 DELETE 一旦声明 application/json，
    // 默认解析器按空 JSON 解析直接抛 400「请求无法处理」
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
    })
    expect(del.statusCode).toBe(200)
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

  it('备注 note：创建入库、PATCH 可清空（null）、可按 q 搜索命中', async () => {
    const created = await createAs(alice.cookie, { note: '重装 k3s 的安装脚本' })
    expect(created.statusCode).toBe(201)
    expect(created.json().data.note).toBe('重装 k3s 的安装脚本')

    // 按备注搜索命中（GET / 的 q 同时扫 title/content/note）
    const hit = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets?q=安装脚本',
      headers: { cookie: alice.cookie },
    })
    expect(hit.json().data).toHaveLength(1)
    expect(hit.json().data[0].id).toBe(uuid(1))

    // PATCH 清空备注
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
      payload: { note: null, updatedAt: Date.now() + 5000 },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().data.note).toBeNull()

    // 清空后按备注搜索不再命中
    const miss = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets?q=安装脚本',
      headers: { cookie: alice.cookie },
    })
    expect(miss.json().data).toHaveLength(0)
  })

  it('旧版客户端省略 note 的更新不清空已有备注（省略 ≠ 显式 null）', async () => {
    await createAs(alice.cookie, { note: '要保留的备注' })

    // 旧版客户端的 upsert（POST 同 id、updatedAt 更新、不带 note 字段）
    const upsert = await createAs(alice.cookie, {
      title: '旧版客户端的修改',
      updatedAt: Date.now() + 5000,
    })
    expect(upsert.statusCode).toBe(200)
    expect(upsert.json().data.note).toBe('要保留的备注')

    // sync 上行同样省略 note：备注保留
    const synced = await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets/sync',
      headers: { cookie: alice.cookie },
      payload: { since: 0, changes: [snippetPayload({ updatedAt: Date.now() + 6000 })] },
    })
    expect(synced.json().data.applied).toEqual([uuid(1)])
    const row = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(row.note).toBe('要保留的备注')
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

/**
 * 回收站端点契约：列表 / 恢复 / 彻底删除 / 清空，以及 `/trash` 与 `/:id` 的路由优先级。
 * 这些用例只在测试库可达时运行（数据库不可达时整组跳过，见 helpers.databaseAvailable）。
 */
describe.skipIf(!dbUp)('Snippet 回收站 API', () => {
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

  const deleteAs = (cookie: string, id: string) =>
    ctx.app.inject({ method: 'DELETE', url: `/api/snippets/${id}`, headers: { cookie } })

  const getTrash = (cookie: string) =>
    ctx.app.inject({ method: 'GET', url: '/api/snippets/trash', headers: { cookie } })

  const restoreAs = (cookie: string, id: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/snippets/${id}/restore`,
      headers: { cookie },
    })

  const purgeAs = (cookie: string, id: string) =>
    ctx.app.inject({ method: 'DELETE', url: `/api/snippets/${id}/purge`, headers: { cookie } })

  it('未授权访问回收站返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/snippets/trash' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /trash 只列墓碑、按删除时间倒序，并回传保留天数（30）', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    await createAs(alice.cookie, { id: uuid(2) })
    await createAs(alice.cookie, { id: uuid(3) })
    await deleteAs(alice.cookie, uuid(1))
    await deleteAs(alice.cookie, uuid(2))

    const res = await getTrash(alice.cookie)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as { id: string; deletedAt: number }[]
    expect(data.map((s) => s.id).sort()).toEqual([uuid(1), uuid(2)])
    // 只在用的条目（uuid(3)）不进回收站
    expect(data.some((s) => s.id === uuid(3))).toBe(false)
    // 按删除时间倒序（同毫秒删除时允许并列，因此只断言非递增）
    const times = data.map((s) => s.deletedAt)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(res.json().meta).toMatchObject({ total: 2, retentionDays: 30 })
  })

  it('路由冲突：DELETE /trash 命中静态路由，空回收站返回 200 count 0（不会被 /:id 当作非法 uuid 拒绝）', async () => {
    const empty = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/snippets/trash',
      headers: { cookie: alice.cookie },
    })
    expect(empty.statusCode).toBe(200)
    expect(empty.json().data).toEqual({ count: 0 })

    await createAs(alice.cookie, { id: uuid(1) })
    await createAs(alice.cookie, { id: uuid(2) })
    await deleteAs(alice.cookie, uuid(1))
    await deleteAs(alice.cookie, uuid(2))

    const cleared = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/snippets/trash',
      headers: { cookie: alice.cookie },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().data).toEqual({ count: 2 })
    expect(await ctx.prisma.snippet.count()).toBe(0)
    expect((await getTrash(alice.cookie)).json().data).toHaveLength(0)
  })

  it('清空回收站不误伤在用条目', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    await createAs(alice.cookie, { id: uuid(2) })
    await deleteAs(alice.cookie, uuid(1))

    await ctx.app.inject({
      method: 'DELETE',
      url: '/api/snippets/trash',
      headers: { cookie: alice.cookie },
    })
    const rows = await ctx.prisma.snippet.findMany()
    expect(rows.map((r) => r.id)).toEqual([uuid(2)])
    expect(rows[0].deletedAt).toBeNull()
  })

  it('POST /:id/restore：deletedAt 归 null，updatedAt / syncedAt 同步推进，其它设备按旧游标也能拉到恢复', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    await deleteAs(alice.cookie, uuid(1))
    const tombstone = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })

    const res = await restoreAs(alice.cookie, uuid(1))
    expect(res.statusCode).toBe(200)
    expect(res.json().data.deletedAt).toBeNull()

    const restored = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(restored.deletedAt).toBeNull()
    // 两个游标都必须推进：只看 updatedAt 的话游标较新的设备永远收不到「恢复」
    expect(restored.updatedAt.getTime()).toBeGreaterThan(tombstone.updatedAt.getTime())
    expect(restored.syncedAt.getTime()).toBeGreaterThan(tombstone.syncedAt.getTime())

    // 模拟「游标停在删除那一刻」的另一台设备
    const sync = await ctx.app.inject({
      method: 'POST',
      url: '/api/snippets/sync',
      headers: { cookie: alice.cookie },
      payload: { since: tombstone.syncedAt.getTime(), changes: [] },
    })
    expect(sync.statusCode).toBe(200)
    const pulled = (sync.json().data.pulled as { id: string; deletedAt: number | null }[]).find(
      (s) => s.id === uuid(1),
    )
    expect(pulled).toBeDefined()
    expect(pulled?.deletedAt).toBeNull()

    // 恢复后回到片段库列表
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/snippets',
      headers: { cookie: alice.cookie },
    })
    expect(list.json().data.map((s: { id: string }) => s.id)).toEqual([uuid(1)])
  })

  it('restore 幂等：未删除的条目重复恢复返回当前状态；未知 id / 他人条目 404', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    const notTrashed = await restoreAs(alice.cookie, uuid(1))
    expect(notTrashed.statusCode).toBe(200)
    expect(notTrashed.json().data.deletedAt).toBeNull()

    await deleteAs(alice.cookie, uuid(1))
    expect((await restoreAs(alice.cookie, uuid(1))).statusCode).toBe(200)
    expect((await restoreAs(alice.cookie, uuid(1))).statusCode).toBe(200)
    const rows = await ctx.prisma.snippet.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].deletedAt).toBeNull()

    expect((await restoreAs(alice.cookie, uuid(9))).statusCode).toBe(404)
    expect((await restoreAs(bob.cookie, uuid(1))).statusCode).toBe(404)
  })

  it('DELETE /:id/purge：墓碑被硬删；在用条目 409 NOT_TRASHED；他人条目 404', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    await createAs(alice.cookie, { id: uuid(2) })
    await deleteAs(alice.cookie, uuid(1))

    const purged = await purgeAs(alice.cookie, uuid(1))
    expect(purged.statusCode).toBe(200)
    expect(purged.json().data).toEqual({ id: uuid(1), purged: true })
    expect(await ctx.prisma.snippet.count()).toBe(1)

    const live = await purgeAs(alice.cookie, uuid(2))
    expect(live.statusCode).toBe(409)
    expect(live.json().error.code).toBe('NOT_TRASHED')

    expect((await purgeAs(alice.cookie, uuid(9))).statusCode).toBe(404)
    await deleteAs(alice.cookie, uuid(2))
    expect((await purgeAs(bob.cookie, uuid(2))).statusCode).toBe(404)
    expect(await ctx.prisma.snippet.count()).toBe(1) // Bob 删不掉 Alice 的墓碑
  })

  it('回收站按用户隔离：A 的墓碑不出现在 B 的回收站，B 也清不掉', async () => {
    await createAs(alice.cookie, { id: uuid(1) })
    await deleteAs(alice.cookie, uuid(1))

    expect((await getTrash(bob.cookie)).json().data).toHaveLength(0)
    expect((await getTrash(bob.cookie)).json().meta.total).toBe(0)

    const clearedByBob = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/snippets/trash',
      headers: { cookie: bob.cookie },
    })
    expect(clearedByBob.json().data).toEqual({ count: 0 })
    expect(await ctx.prisma.snippet.count()).toBe(1)
  })
})
