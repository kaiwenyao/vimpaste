import type { EditorView } from '@codemirror/view'
import { Vim, getCM } from '@replit/codemirror-vim'
import { jumpToPlaceholder } from './navigation'

/**
 * Vim 集成：
 * - `]v` / `[v` 映射到占位符跳转（复用与工具栏按钮相同的实现）；
 * - 通过 CM5 兼容层的事件跟踪当前模式，供底部状态栏显示。
 */

interface VimFacade {
  cm6: EditorView
  state: {
    vim?: {
      insertMode?: boolean
      visualMode?: boolean
      visualLine?: boolean
      visualBlock?: boolean
      mode?: string
    }
    dialog?: HTMLElement | null
  }
  on(type: string, fn: () => void): void
}

let navigationRegistered = false

export function registerPlaceholderNavigation(): void {
  if (navigationRegistered) return
  navigationRegistered = true
  Vim.defineAction('vimpasteNextPlaceholder', (cm) => {
    jumpToPlaceholder((cm as unknown as VimFacade).cm6, 1)
  })
  Vim.defineAction('vimpastePrevPlaceholder', (cm) => {
    jumpToPlaceholder((cm as unknown as VimFacade).cm6, -1)
  })
  Vim.mapCommand(']v', 'action', 'vimpasteNextPlaceholder', undefined, { context: 'normal' })
  Vim.mapCommand('[v', 'action', 'vimpastePrevPlaceholder', undefined, { context: 'normal' })
}

export type VimModeLabel =
  'NORMAL' | 'INSERT' | 'VISUAL' | 'V-LINE' | 'V-BLOCK' | 'COMMAND' | 'REPLACE'

/** 从 CM5 兼容层推断当前 Vim 模式（含命令行输入中的 COMMAND） */
export function currentVimMode(cm: unknown): VimModeLabel {
  const facade = cm as VimFacade
  const dialog = facade.state?.dialog
  if (dialog) {
    const input = dialog.querySelector('input')
    const value = input?.value ?? ''
    if (value.startsWith(':') || value.startsWith('/') || value.startsWith('?')) return 'COMMAND'
  }
  const vim = facade.state?.vim
  if (!vim) return 'NORMAL'
  if (vim.insertMode) return 'INSERT'
  if (vim.visualMode) {
    if (vim.visualBlock) return 'V-BLOCK'
    if (vim.visualLine) return 'V-LINE'
    return 'VISUAL'
  }
  if (vim.mode === 'replace') return 'REPLACE'
  return 'NORMAL'
}

/**
 * 已挂接模式跟踪的视图 → 上次挂接的 facade。
 * facade.on 只追加不去重：同一 facade 重复挂接会累积监听器；
 * 而 compartment 移除 vim 后重建的是全新 facade（旧监听随旧插件销毁），需重新挂接。
 */
const trackedFacades = new WeakMap<EditorView, VimFacade>()

/** 在视图上挂接模式变化事件；vim 关闭时回调 null。同一 facade 重复挂接是幂等的。 */
export function attachVimModeTracking(
  view: EditorView,
  onMode: (mode: string | null) => void,
): void {
  const cm = getCM(view)
  if (!cm) return
  const facade = cm as unknown as VimFacade
  if (trackedFacades.get(view) === facade) return
  trackedFacades.set(view, facade)
  const report = () => onMode(currentVimMode(facade))
  facade.on('vim-mode-change', report)
  facade.on('dialog', report)
  facade.on('vim-command-done', report)
  onMode(currentVimMode(facade))
}
