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

/** 点击工具栏「已保存片段」并等待片段库页面出现 */
async function openSaved(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '已保存片段' }))
  return await screen.findByRole('heading', { name: '已保存' })
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
  delete document.documentElement.dataset.theme
  document.documentElement.style.removeProperty('--editor-font-size')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    expect(screen.getByRole('button', { name: '已保存片段' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
    // 手动保存模型：编辑器为空时保存不可用
    expect(screen.getByRole('button', { name: '保存到片段库' })).toBeDisabled()
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
    // 编辑内容不允许出现在偏好键里（片段内容按功能要求存放在历史键中）
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
    // 编辑内容不允许出现在偏好键里（片段内容按功能要求存放在历史键中）
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
    // 偏好键永远不含编辑内容（片段内容按功能要求存放在历史键中）
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('YOUR_TOKEN')
    expect(localStorage.getItem(PREFS_KEY) ?? '').not.toContain('k3s')
    unmount()

    // "刷新"：重新挂载全新实例，编辑器从空白开始
    render(<App />)
    expect(getDoc()).toBe('')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').editorMode).toBe('standard')
  })
})

describe('手动保存（唯一的入库入口）', () => {
  it('无自动保存：编辑不落盘；点「保存」写入；状态栏在 未保存/已保存 间切换', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    // 不再有任何防抖自动保存：编辑后存储保持为空
    await new Promise((r) => setTimeout(r, 1900))
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()

    // 状态栏提示未保存
    expect(screen.getByText('未保存')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存到片段库' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    expect(await screen.findByText('已保存到片段库')).toBeInTheDocument()
    expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')
    // 状态栏与工具栏保存按钮都进入「已保存」（两处， getAllByText）
    expect(screen.getAllByText('已保存').length).toBeGreaterThanOrEqual(1)
    // 已保存且无修改：按钮回到禁用态
    expect(screen.getByRole('button', { name: '保存到片段库' })).toBeDisabled()
  })

  it('复制不再写入片段库（note 提示尚未保存）', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<App />)
    setDoc(K3S)
    const copyBtn = screen.getByRole('button', { name: '复制' })
    await waitFor(() => expect(copyBtn).toBeEnabled())
    await user.click(copyBtn)
    expect(await screen.findByRole('status')).toHaveTextContent('已复制到剪贴板')
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
  })

  it('Ctrl/Cmd+S 保存；无修改时按键不重复写入', () => {
    render(<App />)
    setDoc(K3S)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(localStorage.getItem(HISTORY_KEY)).toContain('YOUR_TOKEN')

    const first = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(first).toHaveLength(1)
    // 无修改再按：不产生新条目、不刷新 updatedAt 相关副作用导致条目翻倍
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    const again = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(again).toHaveLength(1)
  })

  it('持续保存更新当前条目；清空后保存另一段内容产生新条目', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    setDoc(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    let list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(list).toHaveLength(1)

    // 清空（两步确认）→ 保存另一段内容 → 第二条
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    setDoc('docker run -d -p 80:80 nginx')
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(list).toHaveLength(2)
    const titles = (list as { title: string }[]).map((e) => e.title)
    expect(titles.some((t) => t.startsWith('docker run'))).toBe(true)
    expect(titles.some((t) => t.startsWith('curl -sfL'))).toBe(true)
  })

  it('在当前条目上粘贴全新内容后保存产生新条目，不覆盖旧条目', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    // 模拟选中全部后直接粘贴新命令（不清空）：编辑器触发 paste 事件
    const cmContent = document.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    fireEvent(cmContent as Element, new Event('paste', { bubbles: true, cancelable: true }))
    setDoc('kubectl get nodes -o wide')
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { title: string }[]
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.title).some((t) => t.startsWith('curl -sfL'))).toBe(true)
    expect(list.map((e) => e.title).some((t) => t.startsWith('kubectl'))).toBe(true)
  })

  it('与最近一条内容相同时复用条目，不重复堆积', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    // 清空再粘贴相同内容后保存：仍只有一条
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    setDoc(K3S)
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown[]
    expect(list).toHaveLength(1)
  })

  it('有未保存修改时打开条目先确认：「保存并继续」先入库再载入新条目', async () => {
    const user = userEvent.setup()
    render(<App />)
    // 先入库两条
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    setDoc('docker run -d -p 80:80 nginx')
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))

    // 修改当前条目（产生未保存修改），然后从片段库打开另一条
    setDoc('docker run -d -p 80:80 nginx --restart=always')
    await openSaved(user)
    await user.click(screen.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }))
    const dialog = screen.getByRole('dialog', { name: '有未保存的修改' })
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '保存并继续' }))

    // 修改先入库，随后载入 curl 条目
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { content: string }[]
    expect(list.some((e) => e.content.includes('--restart=always'))).toBe(true)
    expect(getDoc()).toBe(K3S)
  })

  it('确认对话框选「不保存」：丢弃修改并继续；「取消」原地不动', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    setDoc(K3S.replace('YOUR_TOKEN', 'CHANGED_TOKEN'))

    await openSaved(user)
    await user.click(screen.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }))
    const dialog = screen.getByRole('dialog', { name: '有未保存的修改' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    // 取消：内容原封不动，仍在编辑器里
    expect(getDoc()).toBe(K3S.replace('YOUR_TOKEN', 'CHANGED_TOKEN'))
    expect(screen.queryByRole('dialog', { name: '有未保存的修改' })).not.toBeInTheDocument()

    // 再次触发并放弃：修改丢失，条目保持已保存版本
    await user.click(screen.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }))
    await user.click(
      within(screen.getByRole('dialog', { name: '有未保存的修改' })).getByRole('button', {
        name: '不保存',
      }),
    )
    expect(getDoc()).toBe(K3S)
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { content: string }[]
    expect(list).toHaveLength(1)
    expect(list[0].content).toBe(K3S)
  })
})

describe('「已保存」片段库页面与详情页', () => {
  it('保存 → 打开片段库 → 点条目进详情 → 详情展示完整元信息与全文', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    // 等语言识别完成再保存：详情页的语言字段才断言得到 Shell
    await waitFor(
      () => {
        expect(screen.getByRole('combobox', { name: '语言' })).toHaveValue('shell')
      },
      { timeout: 3000 },
    )
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    await openSaved(user)

    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^curl -sfL/ })).toBeInTheDocument()

    // 点击行 → 详情页
    await user.click(screen.getByRole('button', { name: /^curl -sfL/ }))
    expect(await screen.findByRole('button', { name: '返回片段列表' })).toBeInTheDocument()
    expect(screen.getByText('命令')).toBeInTheDocument()
    // 隐藏的编辑器状态栏也渲染了语言名，用选择器限定详情页网格
    expect(screen.getByText('Shell / Bash', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText(String(K3S.length), { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText(String(K3S.split('\n').length), { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('仅保存在本机')).toBeInTheDocument()
    const pre = screen.getByRole('region', { name: '片段内容' }).querySelector('pre')
    expect(pre?.textContent).toBe(K3S)

    // 返回列表 → 返回编辑器
    await user.click(screen.getByRole('button', { name: '返回片段列表' }))
    await user.click(await screen.findByRole('button', { name: '返回编辑器' }))
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
  })

  it('详情页「在编辑器中打开」直接载入条目并回到编辑器', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    await user.click(screen.getByRole('button', { name: '清空编辑器' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部内容' }))
    expect(getDoc()).toBe('')

    await openSaved(user)
    await user.click(screen.getByRole('button', { name: /^curl -sfL/ }))
    await user.click(await screen.findByRole('button', { name: '在编辑器中打开' }))
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
    // 载入的条目成为活动条目：状态栏与保存按钮显示已保存
    expect(screen.getAllByText('已保存').length).toBeGreaterThanOrEqual(1)
  })

  it('片段库中删除单条与清空全部', async () => {
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
    await openSaved(user)
    await user.click(screen.getByRole('button', { name: '删除「curl 命令」' }))
    expect(localStorage.getItem(HISTORY_KEY)).not.toContain('curl example.com')
    expect(localStorage.getItem(HISTORY_KEY)).toContain('docker ps')

    await user.click(screen.getByRole('button', { name: '清空全部片段' }))
    await user.click(screen.getByRole('button', { name: '确认清空全部片段' }))
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    expect(screen.getByText('还没有保存过任何内容')).toBeInTheDocument()
  })

  it('保存 → 刷新：编辑器为空，片段仍在库中且可恢复', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    setDoc(K3S)
    // 等语言识别完成再保存：条目带 shell 语言
    await waitFor(
      () => {
        expect(screen.getByRole('combobox', { name: '语言' })).toHaveValue('shell')
      },
      { timeout: 3000 },
    )
    await user.click(screen.getByRole('button', { name: '保存到片段库' }))
    unmount()

    // "刷新"：编辑器从空白开始，片段库保留
    render(<App />)
    expect(getDoc()).toBe('')
    await openSaved(user)
    expect(screen.getByRole('button', { name: /^curl -sfL/ })).toBeInTheDocument()

    // 从片段库恢复到编辑器
    await user.click(screen.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }))
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
    expect(screen.getByRole('combobox', { name: '语言' })).toHaveValue('shell')
  })

  it('编辑器视图在切页期间保持挂载：返回后内容不丢', async () => {
    const user = userEvent.setup()
    render(<App />)
    setDoc(K3S)
    await openSaved(user)
    // 切到片段库再返回：编辑器内容保持
    await user.click(screen.getByRole('button', { name: '返回编辑器' }))
    await waitFor(() => {
      expect(getDoc()).toBe(K3S)
    })
  })
})
