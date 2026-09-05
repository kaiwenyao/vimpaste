import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SavedPage } from '../../src/pages/SavedPage'
import { SnippetDetailPage } from '../../src/pages/SnippetDetailPage'
import type { Snippet } from '../../src/storage/snippets'

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
    tags: overrides.tags,
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
    await user.click(screen.getByRole('button', { name: '清空全部片段' }))
    expect(props.onClearAll).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认清空全部片段' }))
    expect(props.onClearAll).toHaveBeenCalledTimes(1)
  })

  it('空库提示手动保存而不是自动保存', () => {
    renderSavedPage({ entries: [] })
    expect(screen.getByText('还没有保存过任何内容')).toBeInTheDocument()
    expect(screen.getByText(/点「保存」/)).toBeInTheDocument()
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
    expect(screen.getByText(String(CONTENT.split('\n').length), { selector: 'dd' })).toBeInTheDocument()
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
    expect(screen.getByText('无', { selector: 'dd' })).toBeInTheDocument() // 集合
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
})
