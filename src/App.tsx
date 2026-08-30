import { useCallback, useEffect, useRef, useState } from 'react'
import { CodeMirrorEditor } from './components/CodeMirrorEditor'
import { HelpDialog } from './components/HelpDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import type { LangId } from './detection/language'
import { detectLanguage, languageLabel } from './detection/language'
import type { EditorApi } from './editor/createEditor'
import { isEditorMode, normalizeFontSize } from './editor/editorMode'
import type { EditorMode } from './editor/editorMode'
import { jumpToPlaceholder } from './editor/navigation'
import { loadPrefs, savePrefs } from './storage/prefs'
import { isThemeId } from './theme/themes'
import type { ThemeId } from './theme/themes'
import { copyText } from './utils/clipboard'

const DETECT_DEBOUNCE_MS = 400
const CLEAR_ARM_MS = 4000
const TOAST_MS = 2200

interface ToastState {
  text: string
  kind: 'ok' | 'info' | 'err'
}

declare global {
  interface Window {
    /** 仅供自动化测试使用的最小句柄；不涉及任何持久化 */
    __vimpaste?: {
      getDoc(): string
      setDoc(text: string): void
      setSel(pos: number): void
      getSelection(): { anchor: number; head: number; from: number; to: number }
    }
    /** 由 main.tsx 注册：激活等待中的新 Service Worker 并刷新页面 */
    __vimpasteApplyUpdate?: (reloadPage?: boolean) => Promise<void>
  }
}

export default function App() {
  const editorRef = useRef<EditorApi | null>(null)
  const [content, setContent] = useState('')
  const [langId, setLangId] = useState<LangId>('plaintext')
  const [manualOverride, setManualOverride] = useState(false)
  const [placeholderCount, setPlaceholderCount] = useState(0)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [editorMode, setEditorMode] = useState<EditorMode>(() => loadPrefs().editorMode)
  const [fontSize, setFontSize] = useState<number>(() => loadPrefs().fontSize)
  const [hintDismissed, setHintDismissed] = useState(() => loadPrefs().hintDismissed)
  const [theme, setTheme] = useState<ThemeId>(() => loadPrefs().theme)
  const [vimMode, setVimMode] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [swUpdateReady, setSwUpdateReady] = useState(false)

  const toastTimer = useRef(0)
  const clearTimer = useRef(0)

  const showToast = useCallback((text: string, kind: ToastState['kind']) => {
    window.clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => () => window.clearTimeout(clearTimer.current), [])

  // 新版本 Service Worker 就绪：显示更新提示条（用户点击才刷新）
  useEffect(() => {
    const onUpdateReady = () => setSwUpdateReady(true)
    window.addEventListener('vimpaste:update-ready', onUpdateReady)
    return () => window.removeEventListener('vimpaste:update-ready', onUpdateReady)
  }, [])

  // 语言自动检测：防抖；用户手动选择后本次内容不再自动覆盖
  useEffect(() => {
    if (manualOverride) return
    const timer = window.setTimeout(() => {
      void detectLanguage(content).then((id) => setLangId(id))
    }, DETECT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content, manualOverride])

  // 应用编辑器键位模式到编辑器实例（编辑器内部对未变化的 mode 提前返回）
  useEffect(() => {
    editorRef.current?.setEditorMode(editorMode)
  }, [editorMode])

  // 持久化非敏感偏好（绝不保存编辑内容）
  useEffect(() => {
    savePrefs({ editorMode, fontSize, hintDismissed, theme })
  }, [editorMode, fontSize, hintDismissed, theme])

  // 颜色主题：同步到 <html data-theme>，样式全部由 CSS 变量驱动
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 字体大小：通过 CSS 变量即时生效
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`)
  }, [fontSize])

  const handleReady = useCallback((api: EditorApi) => {
    editorRef.current = api
    api.view.focus()
    window.__vimpaste = {
      getDoc: () => api.view.state.doc.toString(),
      setDoc: (text: string) => api.setDoc(text),
      setSel: (pos: number) => {
        api.view.dispatch({ selection: { anchor: pos } })
        api.view.focus()
      },
      getSelection: () => {
        const s = api.view.state.selection.main
        return { anchor: s.anchor, head: s.head, from: s.from, to: s.to }
      },
    }
  }, [])

  const handleDocChanged = useCallback((text: string) => {
    setContent(text)
    if (text === '') {
      setManualOverride(false)
      setPlaceholderCount(0)
    }
  }, [])

  const handleLanguageChange = useCallback((id: LangId) => {
    setLangId(id)
    setManualOverride(true)
  }, [])

  const handleEditorModeChange = useCallback((mode: EditorMode) => {
    if (isEditorMode(mode)) setEditorMode(mode)
  }, [])

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(normalizeFontSize(size))
  }, [])

  const handleThemeChange = useCallback((next: ThemeId) => {
    if (isThemeId(next)) setTheme(next)
  }, [])

  const handleCopy = useCallback(async () => {
    const channel = await copyText(content)
    if (channel === 'clipboard') showToast('已复制到剪贴板', 'ok')
    else if (channel === 'fallback') showToast('已复制（降级方式）', 'ok')
    else showToast('复制失败，请手动全选后按 Ctrl/Cmd+C', 'err')
  }, [content, showToast])

  const handleClear = useCallback(() => {
    if (content !== '' && !clearArmed) {
      setClearArmed(true)
      window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setClearArmed(false), CLEAR_ARM_MS)
      return
    }
    editorRef.current?.setDoc('')
    setClearArmed(false)
    showToast('已清空', 'info')
  }, [content, clearArmed, showToast])

  const jump = useCallback((dir: 1 | -1) => {
    const api = editorRef.current
    if (api) jumpToPlaceholder(api.view, dir)
  }, [])

  return (
    <div className="app">
      <Toolbar
        langId={langId}
        langAuto={!manualOverride}
        manualOverride={manualOverride}
        onLanguageChange={handleLanguageChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        onOpenSettings={() => setSettingsOpen(true)}
        placeholderCount={placeholderCount}
        onPrevPlaceholder={() => jump(-1)}
        onNextPlaceholder={() => jump(1)}
        canCopy={content.length > 0}
        onCopy={() => void handleCopy()}
        clearArmed={clearArmed}
        onClear={handleClear}
        onHelp={() => setHelpOpen(true)}
      />

      {!hintDismissed && (
        <aside className="hint" aria-label="首次使用提示">
          <span>
            粘贴命令 → <kbd>]v</kbd> 跳到变量 → 修改 → 复制
          </span>
          <button
            type="button"
            className="btn ghost hint-close"
            aria-label="关闭提示"
            onClick={() => setHintDismissed(true)}
          >
            ×
          </button>
        </aside>
      )}

      {swUpdateReady && (
        <div className="update-banner" role="status">
          <span>发现新版本，点击刷新以更新离线缓存</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void window.__vimpasteApplyUpdate?.(true)}
          >
            立即刷新
          </button>
        </div>
      )}

      <main className="editor-area">
        <CodeMirrorEditor
          editorMode={editorMode}
          onReady={handleReady}
          callbacks={{
            onDocChanged: handleDocChanged,
            onCursor: (line, col) => setCursor({ line, col }),
            onPlaceholderCount: setPlaceholderCount,
            onVimMode: (mode) => setVimMode((prev) => (prev === mode ? prev : mode)),
          }}
        />
      </main>

      <StatusBar
        editorMode={editorMode}
        vimMode={vimMode}
        line={cursor.line}
        col={cursor.col}
        langLabel={languageLabel(langId)}
        chars={content.length}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        editorMode={editorMode}
        onEditorModeChange={handleEditorModeChange}
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
        theme={theme}
        onThemeChange={handleThemeChange}
      />

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}
