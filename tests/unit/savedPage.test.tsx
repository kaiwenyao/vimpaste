import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SavedPage } from '../../src/pages/SavedPage'
import { SnippetDetailPage } from '../../src/pages/SnippetDetailPage'
import type { Snippet } from '../../src/storage/snippets'
import type { ApiCollection } from '../../src/cloud/api'

const NOW = Date.now()
const CONTENT = "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -"

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: overrides.id ?? 'e1',
    title: overrides.title ?? "curl -sfL https://get.k3s.io | K3S_TOKEN='…' sh -s - server",
    content: overrides.content ?? CONTENT,
    langId: overrides.langId ?? 'shell',
    createdAt: overrides.createdAt ?? NOW - 30_000,
    updatedAt: overrides.updatedAt ?? NOW - 30_000,
    kind: overrides.kind ?? 'command',
    pinned: overrides.pinned,
    localOnly: overrides.localOnly,
    note: overrides.note,
    tags: overrides.tags,
    collectionId: overrides.collectionId,
    syncState: overrides.syncState ?? 'local',
  }
}

function renderSavedPage(overrides: Partial<Parameters<typeof SavedPage>[0]> = {}) {
  const props = {
    entries: [snippet()],
    activeId: null,
    onBack: vi.fn(),
    onOpenDetail: vi.fn(),
    onOpenInEditor: vi.fn(),
    onNewPaste: vi.fn(),
    onNewPrompt: vi.fn(),
    onDeleteEntry: vi.fn(),
    onClearAll: vi.fn(),
    onTogglePin: vi.fn(),
    onExport: vi.fn(),
    kindFilter: 'all' as const,
    onKindFilterChange: vi.fn(),
    ...overrides,
  }
  render(<SavedPage {...props} />)
  return props
}

/** 冻结 Date（只冻结时钟、不动定时器）：相对时间文案随渲染时的墙钟漂移，
 * 慢 CI 上模块加载到用例执行隔几秒，「30 秒前」就会变成「31/32 秒前」导致断言失败 */
function freezeClock() {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SavedPage（已保存片段库）', () => {
  it('渲染标题、条数、条目元信息与隐私提示', () => {
    freezeClock()
    renderSavedPage()
    expect(screen.getByRole('heading', { name: '已保存' })).toBeInTheDocument()
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^curl -sfL/ })).toBeInTheDocument()
    expect(screen.getByText(`30 秒前 · Shell / Bash · ${CONTENT.length} 字符`)).toBeInTheDocument()
    expect(screen.getByText('仅保存在本浏览器 · 不上传')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()
  })

  it('按时间分组（今天 / 昨天 / 7 天内 / 更早）', () => {
    freezeClock()
    // 分组按自然日边界划分，时间戳须相对「今日零点」构造，
    // 否则 NOW-36h 之类的固定偏移在凌晨运行时会滑出「昨天」区间
    const startOfToday = new Date(NOW)
    startOfToday.setHours(0, 0, 0, 0)
    const t0 = startOfToday.getTime()
    const DAY = 86_400_000
    renderSavedPage({
      entries: [
        snippet({ id: 'a', updatedAt: NOW - 60_000 }),
        snippet({ id: 'b', updatedAt: t0 - 3_600_000 }),
        snippet({ id: 'c', updatedAt: t0 - 3 * DAY }),
        snippet({ id: 'd', updatedAt: t0 - 40 * DAY }),
      ],
    })
    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('7 天内')).toBeInTheDocument()
    expect(screen.getByText('更早')).toBeInTheDocument()
  })

  it('点击条目行进详情；行内按钮触发 在编辑器打开 / 置顶 / 删除', async () => {
    const user = userEvent.setup()
    const props = renderSavedPage()
    await user.click(screen.getByRole('button', { name: /^curl -sfL/ }))
    expect(props.onOpenDetail).toHaveBeenCalledWith('e1')
    await user.click(screen.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }))
    expect(props.onOpenInEditor).toHaveBeenCalledWith('e1')
    await user.click(screen.getByRole('button', { name: /置顶「curl -sfL/ }))
    expect(props.onTogglePin).toHaveBeenCalledWith('e1')
    await user.click(screen.getByRole('button', { name: /删除「curl -sfL/ }))
    expect(props.onDeleteEntry).toHaveBeenCalledWith('e1')
  })

  it('新建粘贴 / 新建 Prompt / 导出 / 返回编辑器各自触发回调', async () => {
    const user = userEvent.setup()
    const props = renderSavedPage()
    await user.click(screen.getByRole('button', { name: '新建粘贴' }))
    expect(props.onNewPaste).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '新建 Prompt' }))
    expect(props.onNewPrompt).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '导出全部为 JSON' }))
    expect(props.onExport).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '返回编辑器' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('搜索按标题与内容过滤；无匹配时给出提示', async () => {
    const user = userEvent.setup()
    renderSavedPage({
      entries: [snippet({ id: 'a', title: 'kubectl 命令', content: 'kubectl get nodes' })],
    })
    const search = screen.getByRole('textbox', { name: '搜索已保存片段' })
    await user.type(search, 'nodes')
    expect(screen.getByRole('button', { name: /^kubectl 命令/ })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'docker-compose')
    expect(screen.getByText(/没有匹配「docker-compose」的片段/)).toBeInTheDocument()
  })

  it('备注显示在条目行标题下方，且搜索能按备注命中', async () => {
    const user = userEvent.setup()
    renderSavedPage({
      entries: [snippet({ id: 'a', title: 'kubectl 命令', note: '查看集群节点列表' })],
    })
    expect(screen.getByText('查看集群节点列表')).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: '搜索已保存片段' })
    await user.type(search, '集群节点')
    expect(screen.getByRole('button', { name: /^kubectl 命令/ })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, '备注里没有的词')
    expect(screen.getByText(/没有匹配「备注里没有的词」的片段/)).toBeInTheDocument()
  })

  it('类型筛选 chips 点击回调携带筛选 id', async () => {
    const user = userEvent.setup()
    const props = renderSavedPage()
    // 英文副标是 aria-hidden 装饰，可访问名称只有中文
    await user.click(screen.getByRole('button', { name: '命令' }))
    expect(props.onKindFilterChange).toHaveBeenLastCalledWith('command')
    await user.click(screen.getByRole('button', { name: 'Prompt' }))
    expect(props.onKindFilterChange).toHaveBeenLastCalledWith('prompt')
  })

  it('置顶条目排在同组最前并带标记', () => {
    const { container } = render(
      <SavedPage
        entries={[snippet({ id: 'a' }), snippet({ id: 'b', pinned: true })]}
        activeId={null}
        onBack={() => {}}
        onOpenDetail={() => {}}
        onOpenInEditor={() => {}}
        onNewPaste={() => {}}
        onNewPrompt={() => {}}
        onDeleteEntry={() => {}}
        onClearAll={() => {}}
        onTogglePin={() => {}}
        onExport={() => {}}
        kindFilter="all"
        onKindFilterChange={() => {}}
      />,
    )
    const rows = container.querySelectorAll('.history-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.tag.pinned')).not.toBeNull()
    expect(rows[1].querySelector('.tag.pinned')).toBeNull()
  })

  it('当前编辑中的条目带高亮与「编辑中」标记', () => {
    const { container } = render(
      <SavedPage
        entries={[snippet({ id: 'a' }), snippet({ id: 'b' })]}
        activeId="b"
        onBack={() => {}}
        onOpenDetail={() => {}}
        onOpenInEditor={() => {}}
        onNewPaste={() => {}}
        onNewPrompt={() => {}}
        onDeleteEntry={() => {}}
        onClearAll={() => {}}
        onTogglePin={() => {}}
        onExport={() => {}}
        kindFilter="all"
        onKindFilterChange={() => {}}
      />,
    )
    const rows = container.querySelectorAll('.history-row')
    expect(rows[0].classList.contains('active')).toBe(false)
    expect(rows[1].classList.contains('active')).toBe(true)
    expect(within(rows[1] as HTMLElement).getByText('编辑中')).toBeInTheDocument()
  })

  it('清空全部需二次确认', async () => {
    const user = userEvent.setup()
    const props = renderSavedPage()
    await user.click(screen.getByRole('button', { name: '清空全部片段（可在回收站恢复）' }))
    expect(props.onClearAll).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认清空全部片段（可在回收站恢复）' }))
    expect(props.onClearAll).toHaveBeenCalledTimes(1)
  })

  it('页脚有回收站入口，角标显示回收站里的条数（0 时不显示数字）', async () => {
    const user = userEvent.setup()
    const onOpenTrash = vi.fn()
    renderSavedPage({ onOpenTrash, trashCount: 3 })

    const button = screen.getByRole('button', { name: '回收站（3 条）' })
    expect(within(button).getByText('3')).toBeInTheDocument()
    await user.click(button)
    expect(onOpenTrash).toHaveBeenCalledTimes(1)

    cleanup()
    renderSavedPage({ onOpenTrash, trashCount: 0 })
    expect(screen.getByRole('button', { name: '回收站（空）' })).toBeInTheDocument()
  })

  it('不传 onOpenTrash 时不渲染回收站入口（保持可选，不影响其他调用方）', () => {
    renderSavedPage()
    expect(screen.queryByRole('button', { name: /^回收站（/ })).not.toBeInTheDocument()
  })

  it('空库提示手动保存而不是自动保存', () => {
    renderSavedPage({ entries: [] })
    expect(screen.getByText('还没有保存过任何内容')).toBeInTheDocument()
    expect(screen.getByText(/点「保存」/)).toBeInTheDocument()
  })
})

describe('SavedPage（收藏夹管理，云端模式）', () => {
  const COLLECTIONS: ApiCollection[] = [
    { id: 1, name: 'work', color: '#3f8f7d', order: 0 },
    { id: 2, name: '笔记', color: '#5a7fb8', order: 1 },
  ]

  function renderCloudPage(overrides: Partial<Parameters<typeof SavedPage>[0]> = {}) {
    const props = {
      cloudMode: true,
      collections: COLLECTIONS,
      activeCollectionId: null,
      onSelectCollection: vi.fn(),
      collectionCounts: { 1: 3, 2: 0 },
      totalCount: 4,
      onCreateCollection: vi.fn(
        async (name: string, color: string): Promise<ApiCollection | null> => ({
          id: 9,
          name,
          color,
          order: 2,
        }),
      ),
      onUpdateCollection: vi.fn(async () => {}),
      onDeleteCollection: vi.fn(async () => {}),
      onMoveCollection: vi.fn(async () => {}),
      onMoveEntry: vi.fn(),
      ...overrides,
    }
    const view = renderSavedPage(props)
    return { ...props, view }
  }

  it('面板列出全部收藏夹与各自条目数，点击行触发筛选', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    const panel = screen.getByRole('region', { name: '收藏夹' })
    expect(within(panel).getByRole('button', { name: /全部收藏夹/ })).toBeInTheDocument()
    expect(within(panel).getByText('4')).toBeInTheDocument()
    const workRow = within(panel).getByRole('button', { name: /^work/ })
    expect(within(workRow).getByText('3')).toBeInTheDocument()
    const noteRow = within(panel).getByRole('button', { name: /^笔记/ })
    expect(within(noteRow).getByText('0')).toBeInTheDocument()
    // 颜色圆点按用户数据渲染色值（不走主题令牌）
    expect(workRow.querySelector('.collection-dot')).not.toBeNull()

    await user.click(workRow)
    expect(props.onSelectCollection).toHaveBeenCalledWith(1)
    await user.click(within(panel).getByRole('button', { name: /全部收藏夹/ }))
    expect(props.onSelectCollection).toHaveBeenLastCalledWith(null)
  })

  it('未登录时不出现收藏夹面板', () => {
    renderSavedPage()
    expect(screen.queryByRole('region', { name: '收藏夹' })).toBeNull()
    expect(screen.queryByRole('button', { name: /移动到收藏夹/ })).toBeNull()
  })

  it('新建收藏夹：对话框里填名称与颜色后提交', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: /新建收藏夹/ }))
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.type(within(dialog).getByRole('textbox', { name: '名称' }), '  临时  ')
    await user.click(within(dialog).getByRole('radio', { name: '鼠尾草' }))
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(props.onCreateCollection).toHaveBeenCalledWith('临时', '#7d9463')
    // 成功后对话框自行收起
    expect(screen.queryByRole('dialog', { name: '新建收藏夹' })).toBeNull()
  })

  it('新建收藏夹：重名等失败就地报错且对话框不关闭', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({
      onCreateCollection: vi.fn(async () => {
        throw new Error('同名收藏夹已存在')
      }),
    })
    await user.click(screen.getByRole('button', { name: /新建收藏夹/ }))
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.type(within(dialog).getByRole('textbox', { name: '名称' }), 'work')
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(props.onCreateCollection).toHaveBeenCalledTimes(1)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('同名收藏夹已存在')
    expect(screen.getByRole('dialog', { name: '新建收藏夹' })).toBeInTheDocument()
  })

  it('新建收藏夹：名称为空时不发请求，就地提示', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: /新建收藏夹/ }))
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(props.onCreateCollection).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('收藏夹名称不能为空')
  })

  it('新建收藏夹：在名称框里按 Enter 即可提交（键盘可达）', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: /新建收藏夹/ }))
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.type(within(dialog).getByRole('textbox', { name: '名称' }), 'k8s{Enter}')
    expect(props.onCreateCollection).toHaveBeenCalledWith('k8s', expect.any(String))
  })

  it('行内浮层：打开后焦点落在第一项，Enter 即选定', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({ entries: [snippet({ title: 'kubectl get nodes' })] })
    await user.click(screen.getByRole('button', { name: '移动「kubectl get nodes」到收藏夹' }))
    // 浮层打开时焦点已送入第一项（未分类）
    expect(screen.getByRole('button', { name: '未分类' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(props.onMoveEntry).toHaveBeenCalledWith('e1', null)
  })

  it('编辑收藏夹：改名称与颜色后 PATCH', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「work」' }))
    const dialog = screen.getByRole('dialog', { name: '编辑收藏夹「work」' })
    const input = within(dialog).getByRole('textbox', { name: '名称' })
    expect(input).toHaveValue('work')
    await user.clear(input)
    await user.type(input, '工作')
    await user.click(within(dialog).getByRole('radio', { name: '玫瑰' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(props.onUpdateCollection).toHaveBeenCalledWith(1, { name: '工作', color: '#c06a86' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('编辑收藏夹：没有任何改动时保存不发请求', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「work」' }))
    const dialog = screen.getByRole('dialog', { name: '编辑收藏夹「work」' })
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(props.onUpdateCollection).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('排序：上移/下移触发回调，边界上按钮置灰', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「笔记」' }))
    const dialog = screen.getByRole('dialog', { name: '编辑收藏夹「笔记」' })
    // 笔记 order=1 在最后：不能再下移
    expect(within(dialog).getByRole('button', { name: '下移收藏夹「笔记」' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: '上移收藏夹「笔记」' }))
    expect(props.onMoveCollection).toHaveBeenCalledWith(2, -1)
  })

  it('删除收藏夹：二次确认说明会影响到多少条片段，取消则不动', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「work」' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '编辑收藏夹「work」' })).getByRole('button', {
        name: '删除收藏夹',
      }),
    )
    const confirm = screen.getByRole('dialog', { name: '删除收藏夹「work」' })
    expect(confirm).toHaveTextContent('其中的 3 条片段会变为未分类，片段本身不会被删除。')
    await user.click(within(confirm).getByRole('button', { name: '取消' }))
    expect(props.onDeleteCollection).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '管理收藏夹「work」' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '编辑收藏夹「work」' })).getByRole('button', {
        name: '删除收藏夹',
      }),
    )
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    expect(props.onDeleteCollection).toHaveBeenCalledWith(1)
  })

  it('删除空收藏夹时说明「还没有片段」', async () => {
    const user = userEvent.setup()
    renderCloudPage()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「笔记」' }))
    await user.click(screen.getByRole('button', { name: '删除收藏夹' }))
    expect(screen.getByRole('dialog', { name: '删除收藏夹「笔记」' })).toHaveTextContent(
      '这个收藏夹里还没有片段。',
    )
  })

  it('default 是系统收藏夹：不能重命名或删除，但仍可改色', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({
      collections: [{ id: 5, name: 'default', color: '#c96442', order: 0 }],
      collectionCounts: { 5: 1 },
    })
    expect(screen.getByText('系统')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '管理收藏夹「default」' }))
    const dialog = screen.getByRole('dialog', { name: '编辑收藏夹「default」' })
    expect(within(dialog).getByRole('textbox', { name: '名称' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '删除收藏夹' })).toBeDisabled()
    expect(within(dialog).getByText(/系统收藏夹/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: '琥珀' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(props.onUpdateCollection).toHaveBeenCalledWith(5, { color: '#d9a24a' })
  })

  it('行内「移动到收藏夹」：列出未分类与各收藏夹，选中后回写归属', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({ entries: [snippet({ title: 'kubectl get nodes' })] })
    await user.click(screen.getByRole('button', { name: '移动「kubectl get nodes」到收藏夹' }))
    const menu = screen.getByRole('group', { name: '移动到收藏夹' })
    expect(within(menu).getByRole('button', { name: '未分类' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('button', { name: /^work/ }))
    expect(props.onMoveEntry).toHaveBeenCalledWith('e1', 1)
    // 选完即收起
    expect(screen.queryByRole('group', { name: '移动到收藏夹' })).toBeNull()
  })

  it('行内「移动到收藏夹」：可移回未分类，Escape 收起', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({
      entries: [snippet({ title: 'kubectl get nodes', collectionId: 1 })],
    })
    const trigger = screen.getByRole('button', { name: '移动「kubectl get nodes」到收藏夹' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: '移动到收藏夹' })).toBeNull()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '未分类' }))
    expect(props.onMoveEntry).toHaveBeenCalledWith('e1', null)
  })

  it('行内「新建收藏夹…」：创建成功后直接把条目移进去', async () => {
    const user = userEvent.setup()
    const props = renderCloudPage({ entries: [snippet({ title: 'kubectl get nodes' })] })
    await user.click(screen.getByRole('button', { name: '移动「kubectl get nodes」到收藏夹' }))
    await user.click(screen.getByRole('button', { name: '新建收藏夹…' }))
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.type(within(dialog).getByRole('textbox', { name: '名称' }), 'k8s')
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(props.onCreateCollection).toHaveBeenCalledWith('k8s', expect.any(String))
    expect(props.onMoveEntry).toHaveBeenCalledWith('e1', 9)
  })

  it('条目行显示所属收藏夹与色点；筛选到空收藏夹时给出针对性提示', () => {
    renderCloudPage({ entries: [snippet({ title: 'kubectl get nodes', collectionId: 1 })] })
    const tag = screen.getByTitle('收藏夹：work')
    expect(tag.querySelector('.collection-dot')).not.toBeNull()
    cleanup()
    renderCloudPage({ entries: [], activeCollectionId: 1 })
    expect(screen.getByText('这个收藏夹还是空的')).toBeInTheDocument()
  })
})

describe('SnippetDetailPage（条目详情）', () => {
  function renderDetail(overrides: Partial<Parameters<typeof SnippetDetailPage>[0]> = {}) {
    const props = {
      entry: snippet({
        tags: ['k3s', 'install'],
        createdAt: NOW - 86_400_000,
        updatedAt: NOW - 30_000,
      }),
      collections: [],
      onBack: vi.fn(),
      onOpenInEditor: vi.fn(),
      onCopy: vi.fn(),
      onTogglePin: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }
    const view = render(<SnippetDetailPage {...props} />)
    return { props, view }
  }

  it('展示完整元信息：类型 / 语言 / 字符数 / 行数 / 字数 / 同步状态', () => {
    const { view } = renderDetail()
    expect(view.container.querySelector('dl')).not.toBeNull()
    expect(screen.getByText('命令')).toBeInTheDocument()
    expect(screen.getByText('Shell / Bash')).toBeInTheDocument()
    expect(screen.getByText(String(CONTENT.length), { selector: 'dd' })).toBeInTheDocument()
    expect(
      screen.getByText(String(CONTENT.split('\n').length), { selector: 'dd' }),
    ).toBeInTheDocument()
    expect(screen.getByText('仅保存在本机')).toBeInTheDocument()
  })

  it('创建/更新时间包含相对时间，标签逐一渲染', () => {
    freezeClock()
    renderDetail()
    // 创建与更新时间的 dd 内各有一个相对时间副标（冻结时钟后文案确定）
    expect(screen.getByText('1 天前', { selector: '.detail-sub' })).toBeInTheDocument()
    expect(screen.getByText('30 秒前', { selector: '.detail-sub' })).toBeInTheDocument()
    expect(screen.getByText('k3s')).toBeInTheDocument()
    expect(screen.getByText('install')).toBeInTheDocument()
    // 收藏夹与备注都无值时各自显示「无」（按行定位，避免多行「无」互相误配）
    const ddOfRow = (label: string) => {
      const row = screen.getByText(label, { selector: 'dt' }).closest('.detail-row')
      return row?.querySelector('dd')?.textContent
    }
    expect(ddOfRow('收藏夹')).toBe('无')
    expect(ddOfRow('备注')).toBe('无')
  })

  it('备注展示在详情页信息行里', () => {
    renderDetail({ entry: snippet({ note: '重装 k3s 用的安装脚本' }) })
    const row = screen.getByText('备注', { selector: 'dt' }).closest('.detail-row')
    expect(row?.querySelector('dd')?.textContent).toBe('重装 k3s 用的安装脚本')
  })

  it('全文渲染在 <pre> 中且逐字保留', () => {
    renderDetail()
    const pre = screen.getByRole('region', { name: '片段内容' }).querySelector('pre')
    expect(pre?.textContent).toBe(CONTENT)
  })

  it('操作按钮：返回 / 在编辑器打开 / 复制 / 置顶 / 删除（二次确认）', async () => {
    const user = userEvent.setup()
    const { props } = renderDetail()
    await user.click(screen.getByRole('button', { name: '返回片段列表' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '在编辑器中打开' }))
    expect(props.onOpenInEditor).toHaveBeenCalledWith('e1')
    await user.click(screen.getByRole('button', { name: '复制内容' }))
    expect(props.onCopy).toHaveBeenCalledWith(props.entry)
    await user.click(screen.getByRole('button', { name: '置顶' }))
    expect(props.onTogglePin).toHaveBeenCalledWith('e1')

    // 删除需二次确认
    await user.click(screen.getByRole('button', { name: '删除该条目' }))
    expect(props.onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认删除该条目' }))
    expect(props.onDelete).toHaveBeenCalledWith('e1')
  })

  it('Prompt 类型显示 Prompt 标签与 token 估算', () => {
    renderDetail({
      entry: snippet({
        kind: 'prompt',
        langId: 'markdown',
        content: '请审查 {{代码}}：一段比较长的中文提示词内容',
        tags: [],
      }),
    })
    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText(/预估 tokens/)).toBeInTheDocument()
  })

  it('置顶条目按钮态为「已置顶」', () => {
    renderDetail({ entry: snippet({ pinned: true }) })
    expect(screen.getByRole('button', { name: '取消置顶' })).toBeInTheDocument()
    expect(screen.getByText('已置顶')).toBeInTheDocument()
    expect(screen.getByText('是', { selector: 'dd' })).toBeInTheDocument()
  })

  it('云端模式下收藏夹是可编辑下拉：切换即回写归属', async () => {
    const user = userEvent.setup()
    const onMoveEntry = vi.fn()
    const { props } = renderDetail({
      collections: [
        { id: 1, name: 'work', color: '#3f8f7d', order: 0 },
        { id: 2, name: '笔记', color: '#5a7fb8', order: 1 },
      ],
      onMoveEntry,
      onCreateCollection: vi.fn(async () => null),
    })
    const select = screen.getByRole('combobox', { name: '所属收藏夹' })
    expect(select).toHaveValue('')
    await user.selectOptions(select, '1')
    expect(onMoveEntry).toHaveBeenCalledWith('e1', 1)
    // 已归属的条目：下拉显示当前收藏夹名称
    cleanup()
    renderDetail({
      entry: snippet({ collectionId: 2 }),
      collections: [{ id: 2, name: '笔记', color: '#5a7fb8', order: 1 }],
      onMoveEntry,
      onCreateCollection: props.onCreateCollection,
    })
    expect(screen.getByRole('combobox', { name: '所属收藏夹' })).toHaveValue('2')
  })

  it('详情页可直接新建收藏夹并归属当前条目', async () => {
    const user = userEvent.setup()
    const onMoveEntry = vi.fn()
    const createdAt = { id: 7, name: '临时', color: '#3f8f7d', order: 0 }
    renderDetail({
      collections: [{ id: 1, name: 'work', color: '#3f8f7d', order: 0 }],
      onMoveEntry,
      onCreateCollection: vi.fn(async () => createdAt),
    })
    await user.selectOptions(screen.getByRole('combobox', { name: '所属收藏夹' }), '__new__')
    const dialog = screen.getByRole('dialog', { name: '新建收藏夹' })
    await user.type(within(dialog).getByRole('textbox', { name: '名称' }), '临时')
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(onMoveEntry).toHaveBeenCalledWith('e1', 7)
  })

  it('未登录时收藏夹保持只读文本，没有下拉', () => {
    renderDetail({ collections: [{ id: 1, name: 'work', color: '#3f8f7d', order: 0 }] })
    expect(screen.queryByRole('combobox', { name: '所属收藏夹' })).toBeNull()
    const row = screen.getByText('收藏夹', { selector: 'dt' }).closest('.detail-row')
    expect(row?.querySelector('dd')?.textContent).toBe('无')
  })
})
