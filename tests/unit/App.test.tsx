import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'

const K3S = [
  "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\",
  '  --server https://10.10.0.11:6443 \\',
  '  --node-ip 10.10.0.12 \\',
  '  --advertise-address 10.10.0.12 \\',
  '  --flannel-iface eth1',
].join('\n')

const PREFS_KEY = 'vimpaste.prefs.v1'
const HISTORY_KEY = 'vimpaste.history.v1'

function setDoc(text: string) {
  window.__vimpaste?.setDoc(text)
}

function getDoc(): string {
  return window.__vimpaste?.getDoc() ?? ''
}

/** 打开历史面板并返回它 */
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '历史记录' }))
  return screen.getByRole('dialog', { name: '粘贴历史' })
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.style.removeProperty('--editor-font-size')
})

afterEach(() => {
  cleanup()
})

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '设置' }))
  return screen.getByRole('dialog', { name: '编辑器设置' })
}

describe('App 基础渲染与可访问性', () => {
  it('渲染品牌、隐私状态与全部可访问名称', () => {
    render(<App />)
    expect(screen.getByText('VimPaste')).toBeInTheDocument()
    expect(screen.getByText('Local only · 未上传')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '历史记录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空编辑器' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '快捷键帮助' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '颜色主题' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一个占位符' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一个占位符' })).toBeDisabled()
    // 默认 Vim 模式：状态栏显示 NORMAL
    expect(screen.getByLabelText('编辑器模式：NORMAL')).toBeInTheDocument()
  })

  it('切换颜色主题：同步 html[data-theme] 并持久化（偏好不含编辑内容）', async () => {
    const user = userEvent.setup()
    render(<App />)
    const select = screen.getByRole('combobox', { name: '颜色主题' })
    expect(select).toHaveValue('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.selectOptions(select, 'light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').theme).toBe('light')

    setDoc(K3S)
    // 编辑内容不允许出现在偏好键里（历史内容按功能要求存放在历史键中）
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('YOUR_TOKEN')

    // "刷新"：重挂载后主题保留
    cleanup()
    render(<App />)
    expect(screen.getByRole('combobox', { name: '颜色主题' })).toHaveValue('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('combobox', { name: '颜色主题' })).toBeEnabled()
    // 高对比主题也可选
    await user.selectOptions(screen.getByRole('combobox', { name: '颜色主题' }), 'contrast')
    expect(document.documentElement.dataset.theme).toBe('contrast')
  })
})

describe('设置面板', () => {
  it('可打开、有对话框语义，含键位/字号/主题三组设置', async () => {
    const user = userEvent.setup()
    render(<App />)
    const dialog = await openSettings(user)
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: '编辑器键位' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Vim/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /普通编辑器/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Emacs/ })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '字体大小' })).toHaveValue('14')
    await user.click(screen.getByRole('button', { name: '关闭设置' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('切换键位模式：即时生效并持久化（偏好不含编辑内容）', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: /普通编辑器/ }))
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')

    setDoc(K3S)
    // 编辑内容不允许出现在偏好键里（历史内容按功能要求存放在历史键中）
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('YOUR_TOKEN')
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('k3s')
    unmount()

    // "刷新"：重挂载后键位模式保留（状态栏不再显示 Vim 模式徽章）
    render(<App />)
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')
    expect(screen.getByLabelText('编辑器模式：—')).toBeInTheDocument()

    // 切回 Vim
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: /Vim/ }))
    expect(screen.getByLabelText('编辑器模式：NORMAL')).toBeInTheDocument()
  })

  it('调整字体大小：CSS 变量即时生效并持久化，越界值被钳制', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await openSettings(user)
    const slider = screen.getByRole('slider', { name: '字体大小' })
    fireEvent.change(slider, { target: { value: '18' } })
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
    })
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').fontSize).toBe(18)

    unmount()
    render(<App />)
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')

    // 越界值被钳制到允许范围
    await openSettings(user)
    fireEvent.change(screen.getByRole('slider', { name: '字体大小' }), { target: { value: '99' } })
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('20px')
    })
  })
})

describe('首次提示与帮助面板', () => {
  it('首次使用提示显示核心流程且可关闭（持久化）', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    expect(screen.getByText('粘贴命令 →', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(']v')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    unmount()
    render(<App />)
    expect(screen.queryByText('粘贴命令 →', { exact: false })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').hintDismissed).toBe(true)
  })

  it('帮助面板可打开、有对话框语义并可关闭', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '快捷键帮助' }))
    const dialog = screen.getByRole('dialog', { name: '快捷键与使用帮助' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('核心流程', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByText('Ctrl/Cmd+Enter')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭帮助' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Service Worker 新版本就绪时显示提示条，点击立即刷新', async () => {
    const user = userEvent.setup()
    const applyUpdate = vi.fn().mockResolvedValue(undefined)
    window.__vimpasteApplyUpdate = applyUpdate
    render(<App />)
    expect(screen.queryByRole('button', { name: '立即刷新' })).not.toBeInTheDocument()

    window.dispatchEvent(new CustomEvent('vimpaste:update-ready'))
    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent('发现新版本')
    await user.click(screen.getByRole('button', { name: '立即刷新' }))
    expect(applyUpdate).toHaveBeenCalledTimes(1)
    expect(applyUpdate).toHaveBeenCalledWith(true)
    delete window.__vimpasteApplyUpdate
  })
})

describe('编辑内容与占位符', () => {
  it('写入 K3s 命令后出现占位符计数且可导航', async () => {
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(screen.getByText('1 个待替换')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
    const prev = screen.getByRole('button', { name: '上一个占位符' })
    const next = screen.getByRole('button', { name: '下一个占位符' })
    expect(prev).toBeEnabled()
    expect(next).toBeEnabled()
  })

  it('语言自动检测为 Shell（防抖后）', async () => {
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(screen.getByRole('combobox', { name: '语言' })).toHaveValue('shell')
      },
      { timeout: 3000 },
    )
  })

  it('手动选择语言后自动检测不再覆盖', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    const select = screen.getByRole('combobox', { name: '语言' })
    await user.selectOptions(select, 'json')
    expect(select).toHaveValue('json')
    await new Promise((r) => setTimeout(r, 700))
    expect(select).toHaveValue('json')
  }, 10_000)

  it('清空按钮：非空时先确认，确认后清空并重置状态', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    const clearBtn = screen.getByRole('button', { name: '清空编辑器' })
    await user.click(clearBtn)
    // 内容非空时变为确认态，此时内容仍在
    const confirmBtn = screen.getByRole('button', { name: '确认清空全部内容' })
    expect(getDoc()).toBe(K3S)
    await user.click(confirmBtn)
    expect(getDoc()).toBe('')
    expect(screen.getByText('0 个待替换')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
  })
})

describe('复制与隐私', () => {
  it('复制内容与编辑器逐字一致并给出反馈', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<App />)
    setDoc(K3S)
    setDoc(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    const copyBtn = screen.getByRole('button', { name: '复制' })
    await waitFor(() => expect(copyBtn).toBeEnabled())
    await user.click(copyBtn)
    expect(writeText.mock.calls).toHaveLength(1)
    expect(writeText.mock.calls[0][0]).toBe(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制到剪贴板')
  })

  it('编辑内容不进入偏好存储；刷新后编辑器为空、键位偏好保留', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    setDoc(K3S)
    // 修改一个偏好（切换到普通编辑器模式）
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: /普通编辑器/ }))
    // 偏好键永远不含编辑内容（历史内容按功能要求存放在历史键中）
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('YOUR_TOKEN')
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('k3s')
    unmount()

    // "刷新"：重新挂载全新实例，编辑器从空白开始
    render(<App />)
    expect(getDoc()).toBe('')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')
  })
})

describe('粘贴历史', () => {
  it('默认开启：内容防抖写入历史键，面板可见并可恢复；刷新后编辑器从空白开始', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
      },
      { timeout: 3000 },
    )
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('YOUR_TOKEN')
    unmount()

    // "刷新"：编辑器为空，历史仍在
    render(<App />)
    expect(getDoc()).toBe('')
    const panel = await openHistory(user)
    await waitFor(() => {
      expect(panel.querySelector('.history-item')).not.toBeNull()
    })
    expect(panel.textContent).toContain('curl -sfL https://get.k3s.io')
    expect(panel.querySelector('.history-row.active')).toBeNull()

    // 点击恢复：编辑器内容与历史条目一致，条目高亮
    await user.click(within(panel).getByRole('button', { name: /^curl -sfL/ }))
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
    expect(screen.getByRole('combobox', { name: '语言' })).toHaveValue('shell')
    expect(panel.querySelector('.history-row.active')).not.toBeNull()
  })

  it('复制时立即落盘历史（不等待防抖）', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<App />)
    setDoc(K3S)
    const copyBtn = screen.getByRole('button', { name: '复制' })
    await waitFor(() => expect(copyBtn).toBeEnabled())
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    await user.click(copyBtn)
    expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
    expect(await screen.findByRole('status')).toHaveTextContent('已复制到剪贴板')
  })

  it('编辑同一内容持续更新当前条目；清空后重新粘贴新内容产生新条目', async () => {
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
      },
      { timeout: 3000 },
    )
    setDoc(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('MY_TOKEN')
      },
      { timeout: 3000 },
    )
    let list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(list).toHaveLength(1)

    // 清空（两步确认）→ 粘贴另一段内容 → 第二条
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    setDoc('docker run -d -p 80:80 nginx')
    await waitFor(
      () => {
        list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
        expect(list).toHaveLength(2)
      },
      { timeout: 3000 },
    )
    const titles = (list as { title: string }[]).map((e) => e.title)
    expect(titles.some((t) => t.startsWith('docker run'))).toBe(true)
    expect(titles.some((t) => t.startsWith('curl -sfL'))).toBe(true)
  }, 20_000)

  it('在当前条目上粘贴全新内容时产生新条目，不覆盖旧条目', async () => {
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
      },
      { timeout: 3000 },
    )
    // 模拟选中全部后直接粘贴新命令（不清空）：编辑器触发 paste 事件
    const cmContent = document.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    fireEvent(cmContent as Element, new Event('paste', { bubbles: true, cancelable: true }))
    setDoc('kubectl get nodes -o wide')
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('kubectl')
      },
      { timeout: 3000 },
    )
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { title: string }[]
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.title).some((t) => t.startsWith('curl -sfL'))).toBe(true)
    expect(list.map((e) => e.title).some((t) => t.startsWith('kubectl'))).toBe(true)
  }, 20_000)

  it('与最近一条内容相同时复用条目，不重复堆积', async () => {
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
      },
      { timeout: 3000 },
    )
    // 清空再粘贴相同内容：仍只有一条
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    setDoc(K3S)
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
    await new Promise((r) => setTimeout(r, 1800))
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(list).toHaveLength(1)
  })

  it('可删除单条历史', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        {
          id: 'a',
          title: 'curl 命令',
          content: 'curl example.com',
          langId: 'shell',
          createdAt: 1,
          updatedAt: Date.now(),
        },
        {
          id: 'b',
          title: 'docker 命令',
          content: 'docker ps',
          langId: 'shell',
          createdAt: 2,
          updatedAt: Date.now() - 1000,
        },
      ]),
    )
    render(<App />)
    const panel = await openHistory(user)
    await user.click(within(panel).getByRole('button', { name: '删除「curl 命令」' }))
    expect(localStorage.getItem(HISTORY_KEY)).not.toContain('curl example.com')
    expect(localStorage.getItem(HISTORY_KEY)).toContain('docker ps')
  })

  it('清空全部历史：面板清空、存储移除', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        {
          id: 'a',
          title: 'curl 命令',
          content: 'curl example.com',
          langId: 'shell',
          createdAt: 1,
          updatedAt: Date.now(),
        },
      ]),
    )
    render(<App />)
    await openHistory(user)
    await user.click(screen.getByRole('button', { name: '清空全部历史' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部历史' }))
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    expect(screen.getByRole('dialog', { name: '粘贴历史' }).textContent).toContain('暂无历史记录')
  })

  it('关闭自动保存：立即清空历史且不再写入；重新打开后恢复保存', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
      },
      { timeout: 3000 },
    )

    await openHistory(user)
    await user.click(screen.getByRole('switch', { name: '自动保存' }))
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').historyEnabled).toBe(false)

    // 关闭状态下编辑不再写入
    setDoc(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    await new Promise((r) => setTimeout(r, 1900))
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()

    // 重新打开后恢复写入
    await user.click(screen.getByRole('switch', { name: '自动保存' }))
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').historyEnabled).toBe(true)
    await waitFor(
      () => {
        expect(localStorage.getItem(HISTORY_KEY)).toContain('MY_TOKEN')
      },
      { timeout: 3000 },
    )
  }, 20_000)
})
