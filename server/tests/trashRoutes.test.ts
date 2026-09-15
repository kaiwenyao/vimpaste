/**
 * 回收站路由契约测试（**无数据库**）。
 *
 * 为什么需要它：本地开发机上通常没有 Postgres（docker / brew 都没装），
 * `snippets.test.ts` 里的集成测试会整组跳过。但有两件事必须能在本地被验证：
 *   1. `/trash` 与 `/:id` 的路由优先级（find-my-way 静态优先）——
 *      写错的后果是「清空回收站」变成一次 404，用户以为清空了其实一条没删；
 *   2. 恢复端点到底写了哪些字段——updatedAt 与 syncedAt 必须一起推进，
 *      否则游标较新的设备永远收不到「恢复」。
 *
 * 这里用替身 Prisma 记录路由**发出的查询与写入**并断言其形状：
 * 它验证路由意图（where / data），不验证 SQL 行为——真实落库由 CI 里的
 * 集成测试（tests/snippets.test.ts，需要 TEST_DATABASE_URL）覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { buildApp } from '../src/app.js'
import { testEnv } from './helpers.js'

const USER_ID = 7
const COOKIE = 'vimpaste_session=stub-token'
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface Row {
  id: string
  ownerId: number
  title: string
  content: string
  langId: string
  kind: 'command' | 'prompt'
  note: string | null
  pinned: boolean
  usageCount: number
  lastUsedAt: Date | null
  collectionId: number | null
  createdAt: Date
  updatedAt: Date
  syncedAt: Date
  deletedAt: Date | null
  tags: { name: string }[]
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  const now = new Date()
  return {
    id,
    ownerId: USER_ID,
    title: `t-${id}`,
    content: `content-${id}`,
    langId: 'plaintext',
    kind: 'command',
    note: null,
    pinned: false,
    usageCount: 0,
    lastUsedAt: null,
    collectionId: null,
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
    deletedAt: null,
    tags: [],
    ...overrides,
  }
}

/** where.deletedAt 的三种形态：null（在用）、{not: null}（回收站）、undefined（不限） */
function matchesDeletedAt(candidate: Date | null, cond: unknown): boolean {
  if (cond === undefined) return true
  if (cond === null) return candidate === null
  if (typeof cond === 'object' && cond !== null && 'not' in cond) return candidate !== null
  return true
}

class FakePrisma {
  readonly rows = new Map<string, Row>()
  readonly calls = {
    snippetFindMany: [] as Record<string, unknown>[],
    snippetCount: [] as Record<string, unknown>[],
    snippetUpdate: [] as Record<string, unknown>[],
    snippetDelete: [] as Record<string, unknown>[],
    snippetDeleteMany: [] as Record<string, unknown>[],
  }

  /** 会话表：requireAuth 只用到 session.findUnique（含 user 关联） */
  readonly session = {
    // 到期时间必须远于 SESSION_TTL_MS/2，否则 resolveSession 会走滑动续期（session.update）
    findUnique: async () => ({
      id: 'sess-1',
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      userAgent: null,
      user: { id: USER_ID, email: 'stub@example.com', name: null, passwordHash: 'x' },
    }),
    update: async () => undefined,
    delete: async () => undefined,
  }

  private match(where: { ownerId?: number; deletedAt?: unknown; id?: string }): Row[] {
    return [...this.rows.values()].filter(
      (r) =>
        (where.ownerId === undefined || r.ownerId === where.ownerId) &&
        matchesDeletedAt(r.deletedAt, where.deletedAt),
    )
  }

  readonly snippet = {
    findMany: async (args: { where: never; take?: number }) => {
      this.calls.snippetFindMany.push(args as unknown as Record<string, unknown>)
      const found = this.match(args.where)
      return args.take === undefined ? found : found.slice(0, args.take)
    },
    count: async (args: { where: never }) => {
      this.calls.snippetCount.push(args as unknown as Record<string, unknown>)
      return this.match(args.where).length
    },
    findUnique: async (args: { where: { id: string } }) => this.rows.get(args.where.id) ?? null,
    update: async (args: { where: { id: string }; data: Partial<Row> }) => {
      this.calls.snippetUpdate.push(args as unknown as Record<string, unknown>)
      const current = this.rows.get(args.where.id)
      if (!current) throw new Error('row not found')
      const next = { ...current, ...args.data }
      this.rows.set(args.where.id, next)
      return next
    },
    delete: async (args: { where: { id: string } }) => {
      this.calls.snippetDelete.push(args as unknown as Record<string, unknown>)
      const current = this.rows.get(args.where.id)
      if (!current) throw new Error('row not found')
      this.rows.delete(args.where.id)
      return current
    },
    deleteMany: async (args: { where: never }) => {
      this.calls.snippetDeleteMany.push(args as unknown as Record<string, unknown>)
      const found = this.match(args.where)
      for (const r of found) this.rows.delete(r.id)
      return { count: found.length }
    },
  }
}

describe('回收站路由契约（替身 Prisma，无需数据库）', () => {
  let app: FastifyInstance
  let prisma: FakePrisma

  beforeAll(async () => {
    prisma = new FakePrisma()
    app = await buildApp({
      env: testEnv(),
      prisma: prisma as unknown as PrismaClient,
      logLevel: 'error',
    })
  })

  afterAll(async () => {
    await app.close()
  })

  const inject = (method: string, url: string, cookie: string | null = COOKIE) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: cookie === null ? {} : { cookie },
    })

  it('四个回收站端点都要求登录（无 Cookie 一律 401）', async () => {
    for (const [method, url] of [
      ['GET', '/api/snippets/trash'],
      ['DELETE', '/api/snippets/trash'],
      ['POST', `/api/snippets/${uuid(1)}/restore`],
      ['DELETE', `/api/snippets/${uuid(1)}/purge`],
    ]) {
      const res = await inject(method, url, null)
      expect([method, url, res.statusCode]).toEqual([method, url, 401])
    }
  })

  it('路由优先级：DELETE /trash 走静态回收站路由（不是 /:id 的单条删除）', async () => {
    prisma.rows.clear()
    prisma.calls.snippetDeleteMany.length = 0
    prisma.calls.snippetDelete.length = 0

    const empty = await inject('DELETE', '/api/snippets/trash')
    expect(empty.statusCode).toBe(200)
    expect(empty.json().data).toEqual({ count: 0 })

    prisma.rows.set(uuid(1), row(uuid(1), { deletedAt: new Date() }))
    prisma.rows.set(uuid(2), row(uuid(2), { deletedAt: new Date() }))
    prisma.rows.set(uuid(3), row(uuid(3))) // 在用条目

    const cleared = await inject('DELETE', '/api/snippets/trash')
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().data).toEqual({ count: 2 })

    // 只按 ownerId + 墓碑过滤，且没有走单条 delete（那会把 /trash 当 id）
    expect(prisma.calls.snippetDeleteMany.at(-1)).toEqual({
      where: { ownerId: USER_ID, deletedAt: { not: null } },
    })
    expect(prisma.calls.snippetDelete).toHaveLength(0)
    // 在用条目仍在
    expect([...prisma.rows.keys()]).toEqual([uuid(3)])
  })

  it('GET /trash：只查当前用户的墓碑，回传保留天数 30', async () => {
    prisma.rows.clear()
    prisma.calls.snippetFindMany.length = 0
    prisma.rows.set(uuid(1), row(uuid(1), { deletedAt: new Date() }))
    prisma.rows.set(uuid(2), row(uuid(2)))
    prisma.rows.set(uuid(3), row(uuid(3), { ownerId: 99, deletedAt: new Date() }))

    const res = await inject('GET', '/api/snippets/trash')
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((s: { id: string }) => s.id)).toEqual([uuid(1)])
    expect(res.json().meta).toMatchObject({ total: 1, retentionDays: 30 })
    // 查询条件必须带上会话里的 ownerId（越权读不到别人的回收站）
    expect(prisma.calls.snippetFindMany.at(-1)?.where).toEqual({
      ownerId: USER_ID,
      deletedAt: { not: null },
    })
  })

  it('POST /:id/restore：写入 deletedAt=null 且 updatedAt/syncedAt 一起推进', async () => {
    prisma.rows.clear()
    prisma.calls.snippetUpdate.length = 0
    const tombstoneAt = new Date(Date.now() - 60_000)
    prisma.rows.set(
      uuid(1),
      row(uuid(1), {
        deletedAt: tombstoneAt,
        updatedAt: tombstoneAt,
        syncedAt: tombstoneAt,
      }),
    )

    const res = await inject('POST', `/api/snippets/${uuid(1)}/restore`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.deletedAt).toBeNull()

    const call = prisma.calls.snippetUpdate.at(-1) as {
      where: { id: string }
      data: { deletedAt: null; updatedAt: Date; syncedAt: Date }
    }
    expect(call.where).toEqual({ id: uuid(1) })
    expect(call.data.deletedAt).toBeNull()
    expect(call.data.updatedAt).toBeInstanceOf(Date)
    expect(call.data.syncedAt).toBeInstanceOf(Date)
    expect(call.data.updatedAt.getTime()).toBeGreaterThan(tombstoneAt.getTime())
    expect(call.data.syncedAt.getTime()).toBeGreaterThan(tombstoneAt.getTime())
    expect(prisma.rows.get(uuid(1))?.deletedAt).toBeNull()
  })

  it('restore 幂等：未删除的条目不发 update，直接返回当前状态', async () => {
    prisma.rows.clear()
    prisma.calls.snippetUpdate.length = 0
    prisma.rows.set(uuid(1), row(uuid(1)))

    const res = await inject('POST', `/api/snippets/${uuid(1)}/restore`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.deletedAt).toBeNull()
    expect(prisma.calls.snippetUpdate).toHaveLength(0)
  })

  it('POST /:id/restore 对未知 id / 他人条目返回 404', async () => {
    prisma.rows.clear()
    expect((await inject('POST', `/api/snippets/${uuid(9)}/restore`)).statusCode).toBe(404)

    prisma.rows.set(uuid(1), row(uuid(1), { ownerId: 99, deletedAt: new Date() }))
    const foreign = await inject('POST', `/api/snippets/${uuid(1)}/restore`)
    expect(foreign.statusCode).toBe(404)
    expect(foreign.json().error.code).toBe('NOT_FOUND')
    // 他人的墓碑没有被恢复
    expect(prisma.rows.get(uuid(1))?.deletedAt).not.toBeNull()
  })

  it('DELETE /:id/purge：墓碑硬删；在用条目 409 NOT_TRASHED', async () => {
    prisma.rows.clear()
    prisma.rows.set(uuid(1), row(uuid(1), { deletedAt: new Date() }))
    prisma.rows.set(uuid(2), row(uuid(2)))

    const purged = await inject('DELETE', `/api/snippets/${uuid(1)}/purge`)
    expect(purged.statusCode).toBe(200)
    expect(purged.json().data).toEqual({ id: uuid(1), purged: true })
    expect(prisma.rows.has(uuid(1))).toBe(false)

    const live = await inject('DELETE', `/api/snippets/${uuid(2)}/purge`)
    expect(live.statusCode).toBe(409)
    expect(live.json().error.code).toBe('NOT_TRASHED')
    expect(prisma.rows.has(uuid(2))).toBe(true)

    expect((await inject('DELETE', `/api/snippets/${uuid(9)}/purge`)).statusCode).toBe(404)
  })
})
