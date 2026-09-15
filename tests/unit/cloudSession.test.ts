/**
 * 匿名 → 登录的合并向导路径（session.ts）。
 *
 * 核心约束：只有「本机还活着的条目」参与合并；墓碑（deletedAt != null）留在
 * 本机回收站即可，绝不能被当成新建上传——服务端 sync 创建路径强制
 * `deletedAt: null`，一旦上传，登录前删掉的内容就会在云端和其它设备复活。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云 API 全 mock：会话测试不触网
const syncMock = vi.fn()
const deleteSnippetMock = vi.fn()
const logoutMock = vi.fn()
vi.mock('../../src/cloud/api', () => {
  class CloudApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    cloudApi: {
      sync: (...args: unknown[]) => syncMock(...args),
      deleteSnippet: (...args: unknown[]) => deleteSnippetMock(...args),
      logout: (...args: unknown[]) => logoutMock(...args),
    },
    CloudApiError,
  }
})

import { countLocalHistory, startCloudSession } from '../../src/cloud/session'
import type { CloudUser } from '../../src/cloud/api'
import { loadQueue, queueKeyFor } from '../../src/cloud/sync'
import { LOCAL_STORAGE_KEY, trashedSnippets } from '../../src/storage/snippets'

const USER: CloudUser = { id: 1, email: 'merge@example.com', name: null }
const LIVE_ID = '11111111-1111-4111-8111-111111111111'
const DEAD_ID = '22222222-2222-4222-8222-222222222222'

/** 匿名存储里的条目（v1 键）：登录时被 migrateV1ToV2 原样迁进 v2 缓存 */
function anonymousEntry(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    id: LIVE_ID,
    title: '登录前保存的',
    content: 'echo live',
    langId: 'plaintext',
    kind: 'command',
    createdAt: now - 2000,
    updatedAt: now - 1000,
    syncState: 'local',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  syncMock.mockReset()
  deleteSnippetMock.mockReset()
  logoutMock.mockReset()
  syncMock.mockResolvedValue({ applied: [], conflicts: [], pulled: [], now: Date.now() })
})

describe('匿名 → 登录合并（session.localUnsynced）', () => {
  it('匿名删除的墓碑不参与合并：不进队列、服务端收不到、本机回收站仍在', async () => {
    const now = Date.now()
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify([
        anonymousEntry(),
        anonymousEntry({ id: DEAD_ID, title: '登录前删掉的', deletedAt: now - 5000 }),
      ]),
    )

    const session = await startCloudSession(USER, { onStatus: () => {} })

    // 向导只把活条目算作「本机有 N 条历史记录」（墓碑不算）
    expect(session.localUnsynced.map((s) => s.id)).toEqual([LIVE_ID])
    expect(countLocalHistory()).toBe(1)

    session.mergeLocal()
    await session.engine.flush()

    // 上行批次里只有活条目：墓碑绝不作为新建上传
    const push = syncMock.mock.calls.find(
      ([, changes]) => Array.isArray(changes) && changes.length > 0,
    )
    expect(push?.[1].map((c: { id: string }) => c.id)).toEqual([LIVE_ID])
    // 待推队列里同样没有墓碑
    expect(loadQueue(queueKeyFor(USER.id)).upserts.map((s) => s.id)).toEqual([LIVE_ID])

    // 墓碑留在本机回收站，内容没丢
    expect(trashedSnippets(session.store.current()).map((s) => s.id)).toEqual([DEAD_ID])

    session.engine.stop()
  })

  it('本机只剩墓碑时不弹合并向导（localUnsynced 为空）', async () => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify([anonymousEntry({ id: DEAD_ID, deletedAt: Date.now() - 1000 })]),
    )

    const session = await startCloudSession(USER, { onStatus: () => {} })

    expect(session.localUnsynced).toHaveLength(0)
    session.engine.stop()
  })
})
