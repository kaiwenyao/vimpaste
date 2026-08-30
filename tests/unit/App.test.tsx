import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function setDoc(text: string) {
  window.__vimpaste?.setDoc(text)
}

function getDoc(): string {
  return window.__vimpaste?.getDoc() ?? ''
}

function dumpStorage(storage: Storage) {
  return Array.from({ length: storage.length }, (_, i) => [
    storage.key(i),
    storage.getItem(storage.key(i) ?? ''),
  ])
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

  it('切换颜色主题：同步 html[data-theme] 并持久化，编辑内容仍不落盘', async () => {
    const user = userEvent.setup()
    render(<App />)
    const select = screen.getByRole('combobox', { name: '颜色主题' })
    expect(select).toHaveValue('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.selectOptions(select, 'light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').theme).toBe('light')

    setDoc(K3S)
    const stored = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i) ?? ''),
    )
    expect(JSON.stringify(stored)).not.toContain('YOUR_TOKEN')

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

  it('切换键位模式：即时生效并持久化，编辑内容仍不落盘', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: /普通编辑器/ }))
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')

    setDoc(K3S)
    const dump = JSON.stringify([...dumpStorage(localStorage), ...dumpStorage(sessionStorage)])
    expect(dump).not.toContain('YOUR_TOKEN')
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

  it('编辑内容不写入任何 Web 存储；刷新后消失，键位偏好保留', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    setDoc(K3S)
    // 修改一个偏好（切换到普通编辑器模式）
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: /普通编辑器/ }))
    // 编辑内容不写入任何 Web 存储
    const dumpStorage = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, i) => [
        storage.key(i),
        storage.getItem(storage.key(i) ?? ''),
      ])
    const dump = JSON.stringify([...dumpStorage(localStorage), ...dumpStorage(sessionStorage)])
    expect(dump).not.toContain('YOUR_TOKEN')
    expect(dump).not.toContain('k3s')
    unmount()

    // "刷新"：重新挂载全新实例
    render(<App />)
    expect(getDoc()).toBe('')
    for (const storage of [localStorage, sessionStorage]) {
      for (const entry of dumpStorage(storage)) {
        expect(JSON.stringify(entry)).not.toContain('YOUR_TOKEN')
      }
    }
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')
  })
})
