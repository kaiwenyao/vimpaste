import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryPanel } from '../../src/components/HistoryPanel'
import type { HistoryEntry } from '../../src/storage/history'

const NOW = Date.now()
const CONTENT = "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -"

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: overrides.id ?? 'e1',
    title: overrides.title ?? "curl -sfL https://get.k3s.io | K3S_TOKEN='…' sh -s - server",
    content: overrides.content ?? CONTENT,
    langId: overrides.langId ?? 'shell',
    createdAt: overrides.createdAt ?? NOW - 30_000,
    updatedAt: overrides.updatedAt ?? NOW - 30_000,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const props = {
    open: true,
    entries: [entry()],
    enabled: true,
    activeId: null,
    onClose: vi.fn(),
    onOpenEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    onClearAll: vi.fn(),
    onToggleEnabled: vi.fn(),
    onNewPaste: vi.fn(),
    ...overrides,
  }
  render(<HistoryPanel {...props} />)
  return props
}

afterEach(() => {
  cleanup()
})

describe('HistoryPanel', () => {
  it('有对话框语义，渲染标题、条目、元信息与隐私提示', () => {
    renderPanel()
    const dialog = screen.getByRole('dialog', { name: '粘贴历史' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('历史记录')).toBeInTheDocument()
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^curl -sfL/ })).toBeInTheDocument()
    expect(screen.getByText(`30 秒前 · Shell / Bash · ${CONTENT.length} 字符`)).toBeInTheDocument()
    expect(screen.getByText('仅保存在本浏览器 · 不上传')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()
  })

  it('按时间分组（今天 / 昨天 / 7 天内 / 更早）', () => {
    renderPanel({
      entries: [
        entry({ id: 'a', updatedAt: NOW - 60_000 }),
        entry({ id: 'b', updatedAt: NOW - 36 * 3_600_000 }),
        entry({ id: 'c', updatedAt: NOW - 5 * 86_400_000 }),
        entry({ id: 'd', updatedAt: NOW - 90 * 86_400_000 }),
      ],
    })
    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('7 天内')).toBeInTheDocument()
    expect(screen.getByText('更早')).toBeInTheDocument()
  })

  it('点击条目恢复；悬停删除按钮触发删除回调', async () => {
    const user = userEvent.setup()
    const props = renderPanel()
    await user.click(screen.getByRole('button', { name: /^curl -sfL/ }))
    expect(props.onOpenEntry).toHaveBeenCalledWith('e1')
    await user.click(screen.getByRole('button', { name: /删除「curl -sfL/ }))
    expect(props.onDeleteEntry).toHaveBeenCalledWith('e1')
  })

  it('当前活跃条目有高亮标记', () => {
    const { container } = render(
      <HistoryPanel
        open
        entries={[entry({ id: 'e1' }), entry({ id: 'e2' })]}
        enabled
        activeId="e2"
        onClose={() => {}}
        onOpenEntry={() => {}}
        onDeleteEntry={() => {}}
        onClearAll={() => {}}
        onToggleEnabled={() => {}}
        onNewPaste={() => {}}
      />,
    )
    const rows = container.querySelectorAll('.history-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classList.contains('active')).toBe(false)
    expect(rows[1].classList.contains('active')).toBe(true)
  })

  it('搜索按标题与内容过滤；无匹配时给出提示', async () => {
    const user = userEvent.setup()
    renderPanel({
      entries: [entry({ id: 'a', title: 'kubectl 命令', content: 'kubectl get nodes' })],
    })
    const search = screen.getByRole('textbox', { name: '搜索历史' })
    await user.type(search, 'nodes')
    expect(screen.getByRole('button', { name: /^kubectl 命令/ })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'docker-compose')
    expect(screen.getByText(/没有匹配「docker-compose」的历史/)).toBeInTheDocument()
  })

  it('清空全部需二次确认', async () => {
    const user = userEvent.setup()
    const props = renderPanel()
    await user.click(screen.getByRole('button', { name: '清空全部历史' }))
    expect(props.onClearAll).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认清空全部历史' }))
    expect(props.onClearAll).toHaveBeenCalledTimes(1)
  })

  it('关闭自动保存后隐藏列表与清空按钮，仅剩开关说明', async () => {
    const user = userEvent.setup()
    const props = renderPanel({ entries: [entry()], enabled: false })
    expect(screen.getByText(/历史已关闭/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /清空全部历史/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /curl -sfL/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '自动保存' }))
    expect(props.onToggleEnabled).toHaveBeenCalledWith(true)
  })

  it('Esc 与「关闭历史面板」按钮触发 onClose；新建粘贴触发 onNewPaste', async () => {
    const user = userEvent.setup()
    const props = renderPanel()
    await user.click(screen.getByRole('button', { name: '＋ 新建粘贴' }))
    expect(props.onNewPaste).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '关闭历史面板' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('关闭状态（open=false）不渲染任何内容', () => {
    renderPanel({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
