import { useCallback, useEffect, useRef, useState } from 'react'
import { CodeMirrorEditor } from './components/CodeMirrorEditor'
import { HelpDialog } from './components/HelpDialog'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { IconCheck, IconClose } from './components/icons'
import type { LangId } from './detection/language'
import { detectLanguage, languageLabel } from './detection/language'
import type { EditorApi } from './editor/createEditor'
import { isEditorMode, normalizeFontSize } from './editor/editorMode'
import type { EditorMode } from './editor/editorMode'
import { jumpToPlaceholder } from './editor/navigation'
import {
  createHistoryId,
  deriveTitle,
  loadHistory,
  saveHistory,
  upsertHistory,
} from './storage/history'
import type { HistoryEntry } from './storage/history'
import { loadPrefs, savePrefs } from './storage/prefs'
import { isThemeId } from './theme/themes'
import type { ThemeId } from './theme/themes'
import { copyText } from './utils/clipboard'

const DETECT_DEBOUNCE_MS = 400
const CLEAR_ARM_MS = 4000
const TOAST_MS = 2200
/** 复制反馈（按钮变绿 + 编辑器描边 + 确认条）同进同出的停留时长 */
const COPY_FEEDBACK_MS = 3000
const HISTORY_SAVE_DEBOUNCE_MS = 1500
/** ≥ 该宽度时历史面板固定在编辑器左侧；更窄的视口退化为覆盖式抽屉 */
const DOCKED_HISTORY_QUERY = '(min-width: 768px)'

interface ToastState {
  text: string
  kind: 'ok' | 'info' | 'err'
}

/** 复制结果：text 是无障碍播报的主句，note 是仅供视觉的补充（字符数、是否入库） */
interface CopyFeedback {
  kind: 'ok' | 'err'
  text: string
  note: string
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
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [historyEnabled, setHistoryEnabled] = useState(() => loadPrefs().historyEnabled)
  // 桌面宽视口默认固定展示；窄视口抽屉不自动弹出（避免一进页面就盖住编辑器）
  const [historyOpen, setHistoryOpen] = useState(
    () => loadPrefs().historyPanelOpen && window.matchMedia(DOCKED_HISTORY_QUERY).matches,
  )
  const [historyDocked, setHistoryDocked] = useState(
    () => window.matchMedia(DOCKED_HISTORY_QUERY).matches,
  )
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [vimMode, setVimMode] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null)
  const [swUpdateReady, setSwUpdateReady] = useState(false)

  const toastTimer = useRef(0)
  const clearTimer = useRef(0)
  const copyTimer = useRef(0)

  // 历史快照需要读取最新值，用 ref 镜像状态（commitSnapshot 里避免闭包过期）
  const historyRef = useRef(history)
  const contentRef = useRef(content)
  const langIdRef = useRef(langId)
  const historyEnabledRef = useRef(historyEnabled)
  const activeEntryIdRef = useRef<string | null>(activeEntryId)
  const historyDockedRef = useRef(historyDocked)

  useEffect(() => {
    historyRef.current = history
  }, [history])
  useEffect(() => {
    langIdRef.current = langId
  }, [langId])
  useEffect(() => {
    historyEnabledRef.current = historyEnabled
  }, [historyEnabled])
  useEffect(() => {
    activeEntryIdRef.current = activeEntryId
  }, [activeEntryId])
  useEffect(() => {
    historyDockedRef.current = historyDocked
  }, [historyDocked])

  // 跟随视口宽度在「固定面板」与「抽屉」间切换。跨界时按已存偏好重同步瞬态显隐，
  // 避免面板开着拖窄变成遮挡抽屉、或抽屉关着拖宽后面板不按偏好恢复（只改瞬态，不写偏好）
  useEffect(() => {
    const mq = window.matchMedia(DOCKED_HISTORY_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      setHistoryDocked(e.matches)
      setHistoryOpen(loadPrefs().historyPanelOpen && e.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const showToast = useCallback((text: string, kind: ToastState['kind']) => {
    window.clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => () => window.clearTimeout(clearTimer.current), [])
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

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

  // 持久化非敏感偏好（编辑内容只随粘贴历史功能保存在 vimpaste.history.v1）
  // historyPanelOpen 只由用户显式切换时写入（见 setHistoryPanelOpen），避免窄视口加载时覆盖桌面端的展开偏好
  useEffect(() => {
    savePrefs({
      ...loadPrefs(),
      editorMode,
      fontSize,
      hintDismissed,
      theme,
      historyEnabled,
    })
  }, [editorMode, fontSize, hintDismissed, theme, historyEnabled])

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
    contentRef.current = text
    setContent(text)
    // 一旦继续编辑，「已复制」的三处反馈立即收起——绿色描边不能停留在已被改动的内容上
    window.clearTimeout(copyTimer.current)
    setCopyFeedback(null)
    if (text === '') {
      setManualOverride(false)
      setPlaceholderCount(0)
      // 清空编辑器即开始新的粘贴：与历史条目解除关联（条目本身保留）
      activeEntryIdRef.current = null
      setActiveEntryId(null)
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

  /** 把当前编辑器内容写入/更新历史快照（新建或续写当前条目；与最近一条相同则复用） */
  const commitSnapshot = useCallback(() => {
    const text = contentRef.current
    if (!historyEnabledRef.current || text.trim() === '') return
    const now = Date.now()
    const current = historyRef.current
    const prevId = activeEntryIdRef.current
    const target =
      (prevId ? current.find((e) => e.id === prevId) : undefined) ??
      (current[0] && current[0].content === text ? current[0] : undefined)
    const entry: HistoryEntry = target
      ? {
          ...target,
          content: text,
          langId: langIdRef.current,
          title: deriveTitle(text),
          updatedAt: now,
        }
      : {
          id: createHistoryId(),
          title: deriveTitle(text),
          content: text,
          langId: langIdRef.current,
          createdAt: now,
          updatedAt: now,
        }
    activeEntryIdRef.current = entry.id
    setActiveEntryId(entry.id)
    const next = upsertHistory(current, entry)
    historyRef.current = next
    setHistory(next)
    saveHistory(next)
  }, [])

  // 防抖快照：停止输入 1.5s 后落盘；清空时的解除关联在 handleDocChanged 里完成
  useEffect(() => {
    if (content.trim() === '') return
    const timer = window.setTimeout(commitSnapshot, HISTORY_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content, langId, commitSnapshot])

  // 复制与页面卸载前立即落盘，避免防抖窗口内的修改丢失
  useEffect(() => {
    const flush = () => commitSnapshot()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [commitSnapshot])

  /** 固定面板的显式显隐切换：状态与偏好一起持久化（抽屉形态的开合走 setHistoryOpen，纯瞬态） */
  const setHistoryPanelOpen = useCallback((next: boolean) => {
    setHistoryOpen(next)
    savePrefs({ ...loadPrefs(), historyPanelOpen: next })
  }, [])

  const handleToggleHistory = useCallback(() => {
    // 只有固定面板的切换落盘；窄视口抽屉是临时状态，不覆盖桌面端的展开偏好
    if (historyDockedRef.current) {
      setHistoryPanelOpen(!historyOpen)
    } else {
      setHistoryOpen(!historyOpen)
    }
  }, [historyOpen, setHistoryPanelOpen])

  /** 一次真实粘贴 = 一条新历史：粘贴时与当前条目解除关联（旧条目保留） */
  const handleEditorPaste = useCallback(() => {
    if (activeEntryIdRef.current === null) return
    activeEntryIdRef.current = null
    setActiveEntryId(null)
  }, [])

  const handleOpenEntry = useCallback(
    (id: string) => {
      const entry = historyRef.current.find((e) => e.id === id)
      if (!entry) return
      // 切换前先把当前内容落盘，未保存的修改不会丢
      if (contentRef.current.trim() !== '' && contentRef.current !== entry.content) {
        commitSnapshot()
      }
      activeEntryIdRef.current = id
      setActiveEntryId(id)
      setLangId(entry.langId)
      setManualOverride(true)
      editorRef.current?.setDoc(entry.content)
      editorRef.current?.view.focus()
      // 抽屉形态下点击条目后自动收起；固定面板保持展示
      if (!historyDockedRef.current) setHistoryOpen(false)
    },
    [commitSnapshot],
  )

  const handleDeleteEntry = useCallback((id: string) => {
    const next = historyRef.current.filter((e) => e.id !== id)
    historyRef.current = next
    setHistory(next)
    saveHistory(next)
    if (activeEntryIdRef.current === id) {
      activeEntryIdRef.current = null
      setActiveEntryId(null)
    }
  }, [])

  const handleClearHistory = useCallback(() => {
    historyRef.current = []
    setHistory([])
    saveHistory([])
    activeEntryIdRef.current = null
    setActiveEntryId(null)
  }, [])

  const handleHistoryEnabledChange = useCallback(
    (next: boolean) => {
      historyEnabledRef.current = next
      setHistoryEnabled(next)
      if (!next) {
        handleClearHistory()
      } else if (contentRef.current.trim() !== '') {
        // 重新打开时当前内容可能早已停止输入（防抖不会再触发），立即补一次快照
        commitSnapshot()
      }
    },
    [handleClearHistory, commitSnapshot],
  )

  const handleNewPaste = useCallback(() => {
    if (contentRef.current.trim() !== '') commitSnapshot()
    editorRef.current?.setDoc('')
    editorRef.current?.view.focus()
    if (!historyDockedRef.current) setHistoryOpen(false)
  }, [commitSnapshot])

  const showCopyFeedback = useCallback((feedback: CopyFeedback) => {
    window.clearTimeout(copyTimer.current)
    setCopyFeedback(feedback)
    copyTimer.current = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS)
  }, [])

  const handleCopy = useCallback(async () => {
    commitSnapshot()
    const channel = await copyText(content)
    const stored = historyEnabledRef.current ? ' · 已存入历史' : ''
    const note = `${content.length} 字符${stored}`
    if (channel === 'clipboard') showCopyFeedback({ kind: 'ok', text: '已复制到剪贴板', note })
    else if (channel === 'fallback')
      showCopyFeedback({ kind: 'ok', text: '已复制（降级方式）', note })
    else
      showCopyFeedback({
        kind: 'err',
        text: '复制失败，请手动全选后按 Ctrl/Cmd+C',
        note: '',
      })
  }, [content, showCopyFeedback, commitSnapshot])

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
        onToggleHistory={handleToggleHistory}
        historyOpen={historyOpen}
        placeholderCount={placeholderCount}
        onPrevPlaceholder={() => jump(-1)}
        onNextPlaceholder={() => jump(1)}
        canCopy={content.length > 0}
        copied={copyFeedback?.kind === 'ok'}
        onCopy={() => void handleCopy()}
        clearArmed={clearArmed}
        onClear={handleClear}
        onHelp={() => setHelpOpen(true)}
      />

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

      <div className="app-body">
        {historyOpen && historyDocked && (
          <HistoryPanel
            variant="docked"
            open
            entries={history}
            enabled={historyEnabled}
            activeId={activeEntryId}
            onClose={() => setHistoryPanelOpen(false)}
            onOpenEntry={handleOpenEntry}
            onDeleteEntry={handleDeleteEntry}
            onClearAll={handleClearHistory}
            onToggleEnabled={handleHistoryEnabledChange}
            onNewPaste={handleNewPaste}
          />
        )}

        <main className="editor-area">
          {!hintDismissed && (
            <aside className="hint" aria-label="首次使用提示">
              <span className="hint-flow">
                粘贴命令 → <kbd>]v</kbd> 跳到变量 → 修改 → 复制
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn icon hint-close"
                aria-label="关闭提示"
                onClick={() => setHintDismissed(true)}
              >
                <IconClose size={11} />
              </button>
            </aside>
          )}

          {/* 复制成功时整框描一圈鼠尾草绿：余光可见，不必回头看按钮 */}
          <div className={`editor-frame ${copyFeedback?.kind === 'ok' ? 'copied' : ''}`}>
            <CodeMirrorEditor
              editorMode={editorMode}
              onReady={handleReady}
              callbacks={{
                onDocChanged: handleDocChanged,
                onCursor: (line, col) => setCursor({ line, col }),
                onPlaceholderCount: setPlaceholderCount,
                onVimMode: (mode) => setVimMode((prev) => (prev === mode ? prev : mode)),
                onPaste: handleEditorPaste,
              }}
            />
          </div>

          {copyFeedback && (
            <div className={`copy-confirm ${copyFeedback.kind === 'err' ? 'err' : ''}`}>
              <span className="copy-confirm-mark" aria-hidden="true">
                {copyFeedback.kind === 'ok' ? <IconCheck size={13} /> : <IconClose size={13} />}
              </span>
              {/* 播报主句单独成元素，字符数等补充信息不进无障碍名称 */}
              <span className="copy-confirm-text" role="status">
                {copyFeedback.text}
              </span>
              {copyFeedback.note !== '' && (
                <span className="copy-confirm-note" aria-hidden="true">
                  {copyFeedback.note}
                </span>
              )}
            </div>
          )}
        </main>
      </div>

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

      {historyOpen && !historyDocked && (
        <HistoryPanel
          variant="drawer"
          open
          entries={history}
          enabled={historyEnabled}
          activeId={activeEntryId}
          // 抽屉的 Esc / 遮罩 / ✕ 关闭都只改瞬态，不写 historyPanelOpen
          onClose={() => setHistoryOpen(false)}
          onOpenEntry={handleOpenEntry}
          onDeleteEntry={handleDeleteEntry}
          onClearAll={handleClearHistory}
          onToggleEnabled={handleHistoryEnabledChange}
          onNewPaste={handleNewPaste}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}
