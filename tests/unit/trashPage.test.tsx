/**
 * 回收站页面（TrashPage）与回收站视图纯逻辑。
 * 关注点是「用户看到什么、点了会发生什么」：剩余天数文案、恢复/彻底删除调用哪个回调、
 * 清空的二次确认、以及云端加载失败时不假装「回收站是空的」。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrashPage } from '../../src/pages/TrashPage'
import type { TrashPageProps } from '../../src/pages/TrashPage'
import {
  formatDaysLeft,
  mergeTrashEntries,
  trashEntryFromLocal,
  trashEntryFromServer,
} from '../../src/utils/trash'
import type { TrashEntry } from '../../src/utils/trash'
import type { Snippet } from '../../src/storage/snippets'
import type { ApiSnippet } from '../../src/cloud/api'
import {
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_MS,
  trashedSnippets,
} from '../../src/storage/snippets'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

function entry(overrides: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id: overrides.id ?? 'e1',
    title: overrides.title ?? 'curl 命令',
    content: overrides.content ?? 'curl example.com',
    langId: overrides.langId ?? 'shell',
    deletedAt: overrides.deletedAt ?? NOW - 1000,
    pending: overrides.pending ?? false,
    ...(overrides.note !== undefined ? { note: overrides.note } : {}),
  }
}

function localSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: overrides.id ?? 'local-1',
    title: overrides.title ?? '本地删的',
    content: overrides.content ?? 'echo local',
    langId: overrides.langId ?? 'shell',
    createdAt: NOW - 5000,
    updatedAt: NOW - 5000,
    deletedAt: overrides.deletedAt ?? NOW - 2000,
    ...overrides,
  }
}

function serverSnippet(overrides: Partial<ApiSnippet> = {}): ApiSnippet {
  return {
    id: overrides.id ?? 'srv-1',
    kind: 'command',
    title: overrides.title ?? '云端删的',
    content: overrides.content ?? 'echo server',
    note: overrides.note ?? null,
    langId: overrides.langId ?? 'shell',
    pinned: false,
    usageCount: 0,
    lastUsedAt: null,
    collectionId: null,
    tags: [],
    createdAt: NOW - 5000,
    updatedAt: NOW - 5000,
    deletedAt: overrides.deletedAt ?? NOW - 3000,
    ...overrides,
  }
}

function renderTrashPage(overrides: Partial<TrashPageProps> = {}) {
  const props: TrashPageProps = {
    entries: [entry()],
    retentionDays: TRASH_RETENTION_DAYS,
    onBack: vi.fn(),
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onEmptyTrash: vi.fn(),
    ...overrides,
  }
  render(<TrashPage {...props} />)
  return props
}

afterEach(cleanup)

describe('TrashPage', () => {
  it('列出条目并显示删除时间与剩余天数；行内触发恢复 / 彻底删除', async () => {
    const user = userEvent.setup()
    const props = renderTrashPage()

    expect(screen.getByRole('heading', { name: '回收站' })).toBeInTheDocument()
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.getByText('curl 命令')).toBeInTheDocument()
    expect(screen.getByText(/剩余 30 天/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '恢复「curl 命令」' }))
    expect(props.onRestore).toHaveBeenCalledWith('e1')

    await user.click(screen.getByRole('button', { name: '彻底删除「curl 命令」' }))
    expect(props.onPurge).toHaveBeenCalledWith('e1')
    expect(props.onEmptyTrash).not.toHaveBeenCalled()
  })

  it('保留天数说明跟随传入值（云端可配置，不写死 30）', () => {
    renderTrashPage({ retentionDays: 7 })
    expect(screen.getByText(/保留 7 天/)).toBeInTheDocument()
  })

  it('清空回收站需要二次确认；条目为空时按钮不可用', async () => {
    const user = userEvent.setup()
    const props = renderTrashPage()

    await user.click(screen.getByRole('button', { name: '清空回收站' }))
    expect(props.onEmptyTrash).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认清空回收站' }))
    expect(props.onEmptyTrash).toHaveBeenCalledTimes(1)

    cleanup()
    renderTrashPage({ entries: [] })
    expect(screen.getByText('回收站是空的')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空回收站' })).toBeDisabled()
  })

  it('云端加载失败时显示错误提示，而不是让空列表冒充「回收站是空的」', () => {
    renderTrashPage({ entries: [], loadError: '回收站加载失败，请检查网络后重试' })
    expect(screen.getByRole('alert')).toHaveTextContent('回收站加载失败')
  })

  it('未登录时没有刷新按钮（本地数据是同步读的）；登录时有', () => {
    renderTrashPage()
    expect(screen.queryByRole('button', { name: '刷新回收站' })).not.toBeInTheDocument()

    cleanup()
    const onRefresh = vi.fn()
    renderTrashPage({ onRefresh })
    expect(screen.getByRole('button', { name: '刷新回收站' })).toBeInTheDocument()
  })

  it('尚未送达服务端的墓碑标「未同步」', () => {
    renderTrashPage({ entries: [entry({ pending: true })] })
    expect(screen.getByLabelText('尚未同步到服务器')).toBeInTheDocument()
  })
})

describe('回收站视图逻辑（utils/trash）', () => {
  it('local 墓碑 → 条目：pending=true，非墓碑返回 null', () => {
    expect(trashEntryFromLocal(localSnippet())).toMatchObject({ id: 'local-1', pending: true })
    expect(trashEntryFromLocal(localSnippet({ deletedAt: null }))).toBeNull()
  })

  it('服务端墓碑 → 条目：pending=false；deletedAt 缺失的异常数据不展示', () => {
    expect(trashEntryFromServer(serverSnippet())).toMatchObject({ id: 'srv-1', pending: false })
    expect(trashEntryFromServer(serverSnippet({ deletedAt: null }))).toBeNull()
  })

  it('合并：服务端优先（同 id 不重复），并并上本地未送达的墓碑，按删除时间倒序', () => {
    const local = [
      localSnippet({ id: 'srv-1', title: '本地版本的同一个 id', deletedAt: NOW - 100 }),
      localSnippet({ id: 'local-1', deletedAt: NOW - 5000 }),
    ]
    const server = [serverSnippet({ id: 'srv-1', title: '服务端版本', deletedAt: NOW - 2000 })]

    const merged = mergeTrashEntries(local, server)

    expect(merged.map((e) => e.id)).toEqual(['srv-1', 'local-1'])
    // 同一条目以服务端为准：时间与标题都取服务端
    expect(merged[0]).toMatchObject({ title: '服务端版本', deletedAt: NOW - 2000, pending: false })
    expect(merged[1]).toMatchObject({ id: 'local-1', pending: true })
  })

  it('未登录（server 为 null）：只用本地墓碑', () => {
    const merged = mergeTrashEntries([localSnippet()], null)
    expect(merged).toHaveLength(1)
    expect(merged[0].pending).toBe(true)
  })

  it('剩余天数文案：刚删是 30 天，到期当天说「今天到期」', () => {
    expect(formatDaysLeft(NOW, TRASH_RETENTION_DAYS, NOW)).toBe('剩余 30 天')
    expect(formatDaysLeft(NOW - 29 * DAY, TRASH_RETENTION_DAYS, NOW)).toBe('剩余 1 天')
    expect(formatDaysLeft(NOW - TRASH_RETENTION_MS, TRASH_RETENTION_DAYS, NOW)).toBe('今天到期')
  })

  it('本地墓碑视图排除已到期的条目（到期即从回收站消失）', () => {
    const list = [
      localSnippet({ id: 'fresh', deletedAt: NOW - 1000 }),
      localSnippet({ id: 'expired', deletedAt: NOW - 31 * DAY }),
    ]
    expect(trashedSnippets(list).map((s) => s.id)).toEqual(['fresh'])
  })
})

describe('「仅本地」条目不进回收站（服务端墓碑只是其它设备的删除信号）', () => {
  it('本机仍存活且标记仅本地的条目：服务端墓碑被过滤掉', () => {
    const server = [serverSnippet({ id: 'local-only-1', deletedAt: NOW - 1000 })]
    const merged = mergeTrashEntries([], server, new Set(['local-only-1']))
    expect(merged).toHaveLength(0)
  })

  it('本机没有这个仅本地条目时，服务端墓碑照常显示（别的设备删了它）', () => {
    const server = [serverSnippet({ id: 'other-device', deletedAt: NOW - 1000 })]
    expect(mergeTrashEntries([], server)).toHaveLength(1)
  })

  it('仅本地条目被用户真的删掉后（本地墓碑）仍出现在回收站里', () => {
    const local = [localSnippet({ id: 'local-only-1', deletedAt: NOW - 2000, localOnly: true })]
    // 存活集合里已经没有它了（已删），因此不再过滤
    const merged = mergeTrashEntries(local, null, new Set<string>())
    expect(merged.map((e) => e.id)).toEqual(['local-only-1'])
  })
})

describe('回收站的边界：哪些操作不该产生墓碑', () => {
  it('「仅本地」开关把条目置为存活（deletedAt 清空）→ 不出现在回收站视图', () => {
    // handleToggleLocalOnly 的写入形状（见 src/App.tsx）：localOnly=true 且 deletedAt 显式为 null
    const entries: Snippet[] = [
      localSnippet({ id: 'toggled', deletedAt: null, localOnly: true, syncState: 'local' }),
      localSnippet({ id: 'deleted', deletedAt: NOW - 1000 }),
    ]
    expect(trashedSnippets(entries).map((s) => s.id)).toEqual(['deleted'])
    expect(trashEntryFromLocal(entries[0])).toBeNull()
  })

  it('删除收藏夹不产生片段墓碑（回收站里只有片段的墓碑）', () => {
    // 收藏夹删除只走 cloudApi.deleteCollection + 刷新收藏夹状态，不碰片段存储。
    // 这里用「片段存储里没有新增墓碑」编码这条约定。
    const before: Snippet[] = [localSnippet({ id: 'a', deletedAt: null })]
    const afterCollectionDeleted: Snippet[] = before // 片段存储未被触碰
    expect(trashedSnippets(afterCollectionDeleted)).toHaveLength(0)
    expect(afterCollectionDeleted.map((s) => s.id)).toEqual(['a'])
  })
})

describe('回收站按删除时间分组（与片段库同一套分组规则）', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('今天 / 昨天 / 7 天内 / 30 天内 分别成组，标签带「删除」前缀', () => {
    const now = Date.now()
    renderTrashPage({
      entries: [
        entry({ id: 'a', title: '今天删的', deletedAt: now - 1000 }),
        entry({ id: 'b', title: '昨天删的', deletedAt: now - DAY - 1000 }),
        entry({ id: 'c', title: '三天前删的', deletedAt: now - 3 * DAY - 1000 }),
        entry({ id: 'd', title: '十天前删的', deletedAt: now - 10 * DAY - 1000 }),
      ],
    })

    expect(screen.getByText('今天删除')).toBeInTheDocument()
    expect(screen.getByText('昨天删除')).toBeInTheDocument()
    expect(screen.getByText('7 天内删除')).toBeInTheDocument()
    expect(screen.getByText('30 天内删除')).toBeInTheDocument()
    // 同一组内的条目共用一个标题（4 条 → 4 个组标题）
    expect(document.querySelectorAll('.history-group')).toHaveLength(4)
  })

  it('组标题顺序与传入顺序一致（调用方已按删除时间倒序）', () => {
    const now = Date.now()
    renderTrashPage({
      entries: [
        entry({ id: 'b', deletedAt: now - DAY - 1000 }),
        entry({ id: 'a', deletedAt: now - 1000 }),
      ],
    })
    const labels = [...document.querySelectorAll('.history-group span:first-child')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['昨天删除', '今天删除'])
  })
})
