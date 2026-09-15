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
