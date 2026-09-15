/**
 * cloud/api.ts 的 request 帮助函数：Content-Type 必须只随 body 出现。
 * 回归：无 body 的 DELETE 曾被一律声明 application/json，服务端按空 JSON
 * 解析直接拒绝（400「请求无法处理」），删除收藏夹 / 删除片段全部失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudApi } from '../../src/cloud/api'

const okEnvelope = () =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true, data: { id: 1, deleted: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloudApi request 头部', () => {
  it('无 body 的 DELETE 不声明 Content-Type（删除收藏夹）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope())
    vi.stubGlobal('fetch', fetchMock)

    await cloudApi.deleteCollection(7)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it('无 body 的 DELETE 不声明 Content-Type（删除片段）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope())
    vi.stubGlobal('fetch', fetchMock)

    await cloudApi.deleteSnippet('abc-1')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it('有 body 的 POST / PATCH 声明 application/json', async () => {
    const fetchMock = vi.fn().mockImplementation(okEnvelope)
    vi.stubGlobal('fetch', fetchMock)

    await cloudApi.createCollection('work')
    await cloudApi.updateCollection(3, { name: 'new name', color: '#7d9463', order: 2 })

    const postInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(postInit.headers).get('content-type')).toBe('application/json')
    const patchInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(patchInit.headers).get('content-type')).toBe('application/json')
  })
})

const jsonEnvelope = (body: unknown, meta?: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true, data: body, ...(meta ? { meta } : {}) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )

const apiSnippetFixture = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'command',
  title: 't',
  content: 'c',
  note: null,
  langId: 'plaintext',
  pinned: false,
  usageCount: 0,
  lastUsedAt: null,
  collectionId: null,
  tags: [],
  createdAt: 1,
  updatedAt: 2,
  deletedAt: 3,
  ...overrides,
})

describe('cloudApi 回收站端点', () => {
  it('trash：映射墓碑列表，并采用服务端回传的保留天数（不写死 30）', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonEnvelope([apiSnippetFixture()], { total: 1, retentionDays: 14 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { items, retentionDays } = await cloudApi.trash()

    expect(fetchMock.mock.calls[0][0]).toBe('/api/snippets/trash')
    expect(items).toHaveLength(1)
    expect(items[0].deletedAt).toBe(3)
    expect(retentionDays).toBe(14)
  })

  it('trash：服务端没给 retentionDays 时回落到 30', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonEnvelope([]))
    vi.stubGlobal('fetch', fetchMock)
    expect((await cloudApi.trash()).retentionDays).toBe(30)
  })

  it('restoreSnippet：POST 到 /:id/restore 并回传恢复后的条目', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonEnvelope(apiSnippetFixture({ deletedAt: null })))
    vi.stubGlobal('fetch', fetchMock)

    const row = await cloudApi.restoreSnippet('abc-1')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/snippets/abc-1/restore')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    // 空 body + JSON 头会被服务端解析器拒绝，因此显式送一个合法 JSON 体
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe('{}')
    expect(row.deletedAt).toBeNull()
  })

  it('purgeSnippet：无 body 的 DELETE，不声明 Content-Type', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonEnvelope({ id: 'abc-1', purged: true }))
    vi.stubGlobal('fetch', fetchMock)

    await cloudApi.purgeSnippet('abc-1')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/snippets/abc-1/purge')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it('emptyTrash：DELETE /trash 并回传物理删除条数', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonEnvelope({ count: 3 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await cloudApi.emptyTrash()).toBe(3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/snippets/trash')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })

  it('恢复失败时抛出带状态码与业务码的错误（不静默吞掉）', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'NOT_TRASHED', message: '条目不在回收站中，请先删除再彻底清除' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(cloudApi.purgeSnippet('abc-1')).rejects.toMatchObject({
      status: 409,
      code: 'NOT_TRASHED',
      message: '条目不在回收站中，请先删除再彻底清除',
    })
    await expect(cloudApi.restoreSnippet('abc-1')).rejects.toMatchObject({ status: 409 })
  })
})
