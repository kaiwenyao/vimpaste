/**
 * /api/snippets/sync 集成测试（plan-v2-accounts.md §7.1）：
 * 下行全量拉取、上行创建/更新、冲突回传服务端版本、墓碑传播、时间戳基线。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createUserAndLogin,
  databaseAvailable,
  setupTestContext,
  snippetPayload,
  truncateAll,
  uuid,
  type TestContext,
} from './helpers.js'

const dbUp = await databaseAvailable()

describe.skipIf(!dbUp)('POST /api/snippets/sync', () => {
  const ctx: TestContext = setupTestContext()
  let alice: Awaited<ReturnType<typeof createUserAndLogin>>
  let bob: Awaited<ReturnType<typeof createUserAndLogin>>

  beforeEach(async () => {
    await truncateAll(ctx.prisma)
    alice = await createUserAndLogin(ctx, 'alice@example.com')
    bob = await createUserAndLogin(ctx, 'bob@example.com')
  })

  const sync = (cookie: string, body: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/snippets/sync',
      headers: { cookie },
      payload: body,
    })

  it('首次同步（since=0）：上行创建 + 下行回显', async () => {
    const res = await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload()],
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().data
    expect(body.applied).toEqual([uuid(1)])
    expect(body.conflicts).toEqual([])
    expect(body.pulled).toHaveLength(1)
    expect(body.pulled[0]).toMatchObject({ id: uuid(1), kind: 'command' })
    expect(typeof body.now).toBe('number')
  })

  it('下行按 since 增量：只返回服务端写入时间晚于基线的条目', async () => {
    await sync(alice.cookie, { since: 0, changes: [snippetPayload()] })
    const first = await sync(alice.cookie, { since: 0, changes: [] })
    const baseline = first.json().data.now
    // 等过基线所在毫秒，确保第二次写入的 syncedAt 严格大于 baseline
    await new Promise((r) => setTimeout(r, 5))
    await sync(alice.cookie, { since: 0, changes: [snippetPayload({ id: uuid(2) })] })
    const res = await sync(alice.cookie, { since: baseline, changes: [] })
    const ids = res.json().data.pulled.map((s: { id: string }) => s.id)
    expect(ids).toEqual([uuid(2)]) // uuid(1) 在基线前写入，不增量返回
  })

  it('离线旧时钟修改后补推送：客户端 updatedAt 早于游标也能被增量拉取', async () => {
    // 设备 A 同步到 baseline；设备 B 此后推送一条客户端时钟更早（离线期间改的）的修改
    const first = await sync(alice.cookie, { since: 0, changes: [snippetPayload()] })
    const baseline = first.json().data.now
    await new Promise((r) => setTimeout(r, 5))
    const stale = await sync(alice.cookie, {
      since: baseline,
      changes: [
        snippetPayload({ id: uuid(2), title: '离线旧时钟修改', updatedAt: baseline - 60_000 }),
      ],
    })
    expect(stale.json().data.applied).toEqual([uuid(2)])
    // A 的下一次增量拉取必须能拿到这条修改（游标按服务端写入时间过滤）
    const res = await sync(alice.cookie, { since: baseline, changes: [] })
    expect(res.json().data.pulled.map((s: { id: string }) => s.id)).toContain(uuid(2))
  })

  it('上行更新：客户端 updatedAt 更新时覆盖服务端', async () => {
    await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ updatedAt: Date.now() - 5000 })],
    })
    const res = await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ content: '更新后的命令' })],
    })
    expect(res.json().data.applied).toEqual([uuid(1)])
    const row = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(row.content).toBe('更新后的命令')
  })

  it('冲突：客户端 updatedAt 早于服务端时不覆盖，回传服务端版本', async () => {
    const serverUpdatedAt = Date.now() - 1000
    await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ title: '服务端版本', updatedAt: serverUpdatedAt })],
    })
    const res = await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ title: '过期的本地版本', updatedAt: serverUpdatedAt - 60_000 })],
    })
    expect(res.json().data.applied).toEqual([])
    expect(res.json().data.conflicts).toHaveLength(1)
    expect(res.json().data.conflicts[0].server.title).toBe('服务端版本')
    // 服务端内容未被覆盖
    const row = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(row.title).toBe('服务端版本')
  })

  it('墓碑传播：软删除推进游标，游标较新的设备也能收到删除', async () => {
    await sync(alice.cookie, { since: 0, changes: [snippetPayload()] })
    // 基线越过条目创建时刻：模拟「另一台设备在最后一次编辑之后才同步过」
    const base = (await sync(alice.cookie, { since: 0, changes: [] })).json().data.now
    await new Promise((r) => setTimeout(r, 5))
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
    })
    const res = await sync(alice.cookie, { since: base, changes: [] })
    const pulled = res.json().data.pulled.find((s: { id: string }) => s.id === uuid(1))
    expect(pulled).toBeDefined()
    expect(pulled.deletedAt).not.toBeNull()
  })

  it('墓碑传播（全量）：软删除后同步可见 deletedAt', async () => {
    await sync(alice.cookie, { since: 0, changes: [snippetPayload()] })
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/snippets/${uuid(1)}`,
      headers: { cookie: alice.cookie },
    })
    const res = await sync(alice.cookie, { since: 0, changes: [] })
    const pulled = res.json().data.pulled.find((s: { id: string }) => s.id === uuid(1))
    expect(pulled.deletedAt).not.toBeNull()
  })

  it('sync 的 collectionId 非法（不存在/他人集合）时置空并照常应用，不 500 不卡批', async () => {
    // 不存在的集合 id：过去会触发外键 500，客户端无限重试
    const stale = await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ collectionId: 999_999 })],
    })
    expect(stale.statusCode).toBe(200)
    expect(stale.json().data.applied).toEqual([uuid(1)])
    expect(
      (await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })).collectionId,
    ).toBeNull()

    // 他人集合 id：不得挂载（租户隔离），同样置空
    const bobCollection = await ctx.prisma.collection.create({
      data: { name: 'B 的集合', ownerId: bob.id },
    })
    const foreign = await sync(alice.cookie, {
      since: 0,
      changes: [snippetPayload({ id: uuid(2), collectionId: bobCollection.id })],
    })
    expect(foreign.statusCode).toBe(200)
    expect(foreign.json().data.applied).toEqual([uuid(2)])
    expect(
      (await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(2) } })).collectionId,
    ).toBeNull()
  })

  it('多用户隔离：B 的同步拉不到 A 的条目，撞 A 的 UUID 只收到空服务端版本', async () => {
    await sync(alice.cookie, { since: 0, changes: [snippetPayload({ title: 'A 的秘密' })] })
    const res = await sync(bob.cookie, { since: 0, changes: [] })
    expect(res.json().data.pulled).toHaveLength(0)

    // B 用与 A 相同的 UUID 上行：不覆盖 A，也不把 A 的数据回传给 B
    const conflict = await sync(bob.cookie, {
      since: 0,
      changes: [snippetPayload({ title: 'B 的版本', updatedAt: Date.now() - 30_000 })],
    })
    expect(conflict.json().data.applied).toEqual([])
    expect(conflict.json().data.conflicts).toHaveLength(1)
    expect(conflict.json().data.conflicts[0].server).toBeNull()
    const rowA = await ctx.prisma.snippet.findUniqueOrThrow({ where: { id: uuid(1) } })
    expect(rowA.title).toBe('A 的秘密')
    expect(rowA.ownerId).toBe(alice.id)
  })

  it('changes 超过 500 条返回 400', async () => {
    const changes = Array.from({ length: 501 }, (_, i) => snippetPayload({ id: uuid(i + 1) }))
    const res = await sync(alice.cookie, { since: 0, changes })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })
})
