import { Compartment, EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { bracketMatching } from '@codemirror/language'
import { defaultKeymap, emacsStyleKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { vim } from '@replit/codemirror-vim'
import type { Extension } from '@codemirror/state'
import type { LangId } from '../detection/language'
import { loadCmLanguage } from './cmLanguage'
import { type EditorMode } from './editorMode'
import { placeholderField, placeholderHighlight, placeholderRanges } from './placeholderField'
import { vimpasteSyntax, vimpasteTheme } from './theme'
import { attachVimModeTracking, registerPlaceholderNavigation } from './vimSetup'

export interface EditorCallbacks {
  onDocChanged(text: string): void
  onCursor(line: number, col: number): void
  onPlaceholderCount(count: number): void
  onVimMode(mode: string | null): void
  /** 用户向编辑器粘贴内容（用于粘贴历史：一次粘贴视为新的条目） */
  onPaste?(): void
}

export interface EditorApi {
  view: EditorView
  setEditorMode(mode: EditorMode): void
  setLanguage(id: LangId): Promise<void>
  setDoc(text: string): void
  destroy(): void
}

/** 各键位模式对应的扩展；Vim 之外不启用模态编辑 */
function editorModeExtensions(mode: EditorMode): Extension[] {
  if (mode === 'vim') return [vim()]
  if (mode === 'emacs') return [Prec.high(keymap.of(emacsStyleKeymap))]
  return []
}

/**
 * 创建编辑器实例。
 * - 不启用 lineWrapping：长行横向滚动，绝不改变命令内容；
 * - 不启用 closeBrackets / autocompletion / 自动缩进：粘贴什么就是什么；
 * - drawSelection 是 Visual 模式正确渲染选区的前提（@replit/codemirror-vim 要求）。
 */
export function createEditor(
  parent: HTMLElement,
  callbacks: EditorCallbacks,
  options: { editorMode: EditorMode } = { editorMode: 'vim' },
): EditorApi {
  // ]v / [v 映射为全局幂等注册
  registerPlaceholderNavigation()

  const modeCompartment = new Compartment()
  const languageCompartment = new Compartment()

  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      callbacks.onDocChanged(u.state.doc.toString())
      callbacks.onPlaceholderCount(placeholderRanges(u.state).length)
    }
    if (u.docChanged || u.selectionSet) {
      const pos = u.state.selection.main.head
      const line = u.state.doc.lineAt(pos)
      callbacks.onCursor(line.number, pos - line.from + 1)
    }
  })

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    history(),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    placeholderField,
    placeholderHighlight,
    search({ top: true }),
    vimpasteTheme,
    vimpasteSyntax,
    updateListener,
    EditorView.domEventHandlers({
      paste: () => {
        callbacks.onPaste?.()
        return false
      },
    }),
    modeCompartment.of(editorModeExtensions(options.editorMode)),
    languageCompartment.of([]),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap]),
  ]

  const view = new EditorView({
    state: EditorState.create({ doc: '', extensions }),
    parent,
  })

  if (options.editorMode === 'vim') {
    attachVimModeTracking(view, callbacks.onVimMode)
  }

  let currentMode: EditorMode = options.editorMode

  return {
    view,
    setEditorMode(mode) {
      if (mode === currentMode) return
      currentMode = mode
      view.dispatch({ effects: modeCompartment.reconfigure(editorModeExtensions(mode)) })
      if (mode === 'vim') {
        attachVimModeTracking(view, callbacks.onVimMode)
      } else {
        callbacks.onVimMode(null)
      }
    },
    async setLanguage(id) {
      const ext = await loadCmLanguage(id)
      if (!view.dom.isConnected) return
      view.dispatch({ effects: languageCompartment.reconfigure(ext ? [ext] : []) })
    },
    setDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
    },
    destroy() {
      view.destroy()
    },
  }
}
