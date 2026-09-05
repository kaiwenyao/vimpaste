import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeMirrorEditor } from './components/CodeMirrorEditor'
import { EntryMetaBar, VariableFillBar } from './components/EntryBar'
import { HelpDialog } from './components/HelpDialog'
import { HistoryPanel } from './components/HistoryPanel'
import type { SnippetKindFilter } from './components/HistoryPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import type { CloudStatusView } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { IconCheck, IconClose } from './components/icons'
import type { LangId } from './detection/language'
import { detectLanguage, languageLabel } from './detection/language'
import { fillPromptTemplate, parsePromptVariables } from './detection/placeholders'
import type { EditorApi } from './editor/createEditor'
import { isEditorMode, normalizeFontSize } from './editor/editorMode'
import type { EditorMode } from './editor/editorMode'
import { jumpToPlaceholder } from './editor/navigation'
import type { CloudSession } from './cloud/session'
import type { SyncStatus } from './cloud/sync'
import type { ApiCollection } from './cloud/api'
import type { Snippet, SnippetKind } from './storage/snippets'
import { LOCAL_SNIPPET_STORAGE, MAX_TAGS_PER_SNIPPET, MAX_TAG_CHARS } from './storage/snippets'
import { LocalSnippetStore } from './storage/SnippetStore'
import type { SnippetStore } from './storage/SnippetStore'
import { loadPrefs, savePrefs } from './storage/prefs'
import { createHistoryId, deriveTitle } from './storage/history'
import { isThemeId } from './theme/themes'
import type { ThemeId } from './theme/themes'
import { copyText } from './utils/clipboard'
import { countWords, estimateTokens } from './utils/textStats'
import { lastVarValues, rememberVarValues } from './utils/varfill'
import { formatRelativeTime } from './utils/time'

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

/** 云端对话框仅在 VITE_CLOUD_ENABLED=true 的构建里存在（define 替换后整支摇掉） */
const AccountDialog =
  import.meta.env.VITE_CLOUD_ENABLED === 'true'
    ? lazy(() => import('./cloud/ui/AccountDialog').then((m) => ({ default: m.AccountDialog })))
    : null

/** 墓碑条目（云端软删除）不进 UI 列表 */
function alive(list: Snippet[]): Snippet[] {
  return list.filter((s) => s.deletedAt == null)
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
  const [store, setStore] = useState<SnippetStore>(() => new LocalSnippetStore(LOCAL_SNIPPET_STORAGE))
  const [history, setHistory] = useState<Snippet[]>(() => alive(store.current()))
  const [historyEnabled, setHistoryEnabled] = useState(() => loadPrefs().historyEnabled)
  // 桌面宽视口默认固定展示；窄视口抽屉不自动弹出（避免一进页面就盖住编辑器）
  const [historyOpen, setHistoryOpen] = useState(
    () => loadPrefs().historyPanelOpen && window.matchMedia(DOCKED_HISTORY_QUERY).matches,
  )
  const [historyDocked, setHistoryDocked] = useState(
    () => window.matchMedia(DOCKED_HISTORY_QUERY).matches,
  )
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [editorKind, setEditorKind] = useState<SnippetKind>('command')
  const [kindFilter, setKindFilter] = useState<SnippetKindFilter>('all')
  const [vimMode, setVimMode] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null)
  const [swUpdateReady, setSwUpdateReady] = useState(false)
  // 云端（VITE_CLOUD_ENABLED）状态；匿名构建恒为 null / idle
  const [cloudUser, setCloudUser] = useState<{ email: string } | null>(null)
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle', lastSyncAt: null })
  const [accountOpen, setAccountOpen] = useState(false)
  const [collections, setCollections] = useState<ApiCollection[]>([])
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})

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
  const editorKindRef = useRef(editorKind)
  const storeRef = useRef(store)
  const sessionRef = useRef<CloudSession | null>(null)

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
  useEffect(() => {
    editorKindRef.current = editorKind
  }, [editorKind])
  useEffect(() => {
    storeRef.current = store
  }, [store])
  useEffect(() => {
    sessionRef.current = cloudSession
  }, [cloudSession])

  // store 换绑（登录 / 登出）或条目变化：同步快照到 React 状态（墓碑不进 UI）
  useEffect(() => {
    const apply = (list: Snippet[]) => {
      historyRef.current = alive(list)
      setHistory(historyRef.current)
    }
    apply(store.current())
    return store.subscribe(apply)
  }, [store])

  /** 活动条目（编辑中的那条） */
  const activeEntry = history.find((e) => e.id === activeEntryId) ?? null

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

  // 云端会话静默恢复（VITE_CLOUD_ENABLED 构建；匿名构建整段摇掉）
  useEffect(() => {
    if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
    let disposed = false
    void (async () => {
      const { restoreSession } = await import('./cloud/session')
      const session = await restoreSession({ onStatus: setSyncStatus })
      if (disposed || !session) return
      sessionRef.current = session
      setCloudSession(session)
      setCloudUser(session.user)
      setSyncStatus(session.engine.currentStatus())
      setStore(session.store)
      const { cloudApi } = await import('./cloud/api')
      try {
        setCollections(await cloudApi.collections())
      } catch {
        /* 集合加载失败不阻塞编辑，下次登录/同步时重试 */
      }
    })()
    return () => {
      disposed = true
      sessionRef.current?.engine.stop()
    }
  }, [])

  // 语言自动检测：防抖；用户手动选择后本次内容不再自动覆盖；prompt 类型关闭识别（§8）
  useEffect(() => {
    if (manualOverride || editorKind === 'prompt') return
    const timer = window.setTimeout(() => {
      void detectLanguage(content).then((id) => setLangId(id))
    }, DETECT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content, manualOverride, editorKind])

  // 编辑器类型（command / prompt）切换到编辑器实例
  useEffect(() => {
    void editorRef.current?.setKind(editorKind)
  }, [editorKind])

  // 应用编辑器键位模式到编辑器实例（编辑器内部对未变化的 mode 提前返回）
  useEffect(() => {
    editorRef.current?.setEditorMode(editorMode)
  }, [editorMode])

  // 持久化非敏感偏好（编辑内容只随片段功能保存在历史存储键中）
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

  /** 把当前编辑器内容写入/更新片段快照（新建或续写当前条目；与最近一条相同则复用） */
  const commitSnapshot = useCallback(() => {
    const text = contentRef.current
    if (!historyEnabledRef.current || text.trim() === '') return
    const now = Date.now()
    const current = historyRef.current
    const prevId = activeEntryIdRef.current
    const kind = editorKindRef.current
    const langForKind: LangId =
      kind === 'prompt' ? (langIdRef.current === 'markdown' ? 'markdown' : 'plaintext') : langIdRef.current
    const target =
      (prevId ? current.find((e) => e.id === prevId) : undefined) ??
      (current[0] && current[0].content === text ? current[0] : undefined)
    const entry: Snippet = target
      ? {
          ...target,
          content: text,
          langId: (target.kind ?? 'command') === 'prompt' ? langForKind : langIdRef.current,
          title: deriveTitle(text),
          updatedAt: now,
          syncState: sessionRef.current ? 'pending' : 'local',
        }
      : {
          id: createHistoryId(),
          title: deriveTitle(text),
          content: text,
          langId: langForKind,
          createdAt: now,
          updatedAt: now,
          kind,
          syncState: sessionRef.current ? 'pending' : 'local',
        }
    activeEntryIdRef.current = entry.id
    setActiveEntryId(entry.id)
    storeRef.current.upsert(entry)
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
      const entryKind = entry.kind ?? 'command'
      setEditorKind(entryKind)
      setLangId(entryKind === 'prompt' && entry.langId !== 'markdown' ? 'plaintext' : entry.langId)
      setManualOverride(true)
      editorRef.current?.setDoc(entry.content)
      editorRef.current?.view.focus()
      // 抽屉形态下点击条目后自动收起；固定面板保持展示
      if (!historyDockedRef.current) setHistoryOpen(false)
    },
    [commitSnapshot],
  )

  const handleDeleteEntry = useCallback((id: string) => {
    // 云端模式：remove 触发 onRemove 钩子 → 入队软删除（墓碑由服务端传播）
    storeRef.current.remove(id)
    if (activeEntryIdRef.current === id) {
      activeEntryIdRef.current = null
      setActiveEntryId(null)
    }
  }, [])

  const handleClearHistory = useCallback(() => {
    const session = sessionRef.current
    if (session) {
      // 云端模式：清空 = 全部软删除（仅本地条目直接丢弃，不惊动服务器）
      for (const s of historyRef.current) {
        if (!s.localOnly) session.engine.enqueueDelete(s.id)
      }
    }
    storeRef.current.replaceAll([])
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
    setEditorKind('command')
    // 从 prompt 形态切回：解除手动覆盖，语言识别重新接管（内容为空时归位纯文本）
    setManualOverride(false)
    setLangId((prev) => (prev === 'markdown' ? 'plaintext' : prev))
    editorRef.current?.setDoc('')
    editorRef.current?.view.focus()
    if (!historyDockedRef.current) setHistoryOpen(false)
  }, [commitSnapshot])

  /** 新建 Prompt：编辑器切到 prompt 形态（软换行 + {{变量}} 占位符），不识别语言 */
  const handleNewPrompt = useCallback(() => {
    if (contentRef.current.trim() !== '') commitSnapshot()
    activeEntryIdRef.current = null
    setActiveEntryId(null)
    setEditorKind('prompt')
    setLangId('markdown')
    setManualOverride(true)
    editorRef.current?.setDoc('')
    editorRef.current?.view.focus()
    if (!historyDockedRef.current) setHistoryOpen(false)
  }, [commitSnapshot])

  const handleTogglePin = useCallback((id: string) => {
    const entry = historyRef.current.find((e) => e.id === id)
    if (!entry) return
    storeRef.current.upsert({
      ...entry,
      pinned: !entry.pinned,
      syncState: sessionRef.current ? 'pending' : 'local',
    })
  }, [])

  /** 「仅本地」开关（§7.4）：已同步条目先向服务端发一次删除再转本地 */
  const handleToggleLocalOnly = useCallback((id: string) => {
    const entry = historyRef.current.find((e) => e.id === id)
    if (!entry) return
    const session = sessionRef.current
    const now = Date.now()
    if (entry.localOnly) {
      // 解除仅本地：转为待同步条目（钩子会入队推送）
      storeRef.current.upsert({
        ...entry,
        localOnly: false,
        syncState: 'pending',
        updatedAt: now,
      })
      return
    }
    if (session && entry.syncState === 'synced') {
      session.engine.enqueueDelete(entry.id)
      void session.engine.flush()
    }
    storeRef.current.upsert({
      ...entry,
      localOnly: true,
      syncState: 'local',
      deletedAt: null,
      updatedAt: now,
    })
  }, [])

  const handleTagsChange = useCallback((id: string, tags: string[]) => {
    const entry = historyRef.current.find((e) => e.id === id)
    if (!entry) return
    // 与服务端 schema（tags ≤ 20 个、单个 ≤ 64 字符）对齐：超限的标签若原样入队，
    // sync 会整批 400 且无限重试，堵死后续所有同步
    const sanitized = [
      ...new Set(
        tags
          .map((t) => t.trim())
          .filter((t) => t !== '')
          .map((t) => (t.length > MAX_TAG_CHARS ? t.slice(0, MAX_TAG_CHARS) : t)),
      ),
    ].slice(0, MAX_TAGS_PER_SNIPPET)
    storeRef.current.upsert({
      ...entry,
      tags: sanitized,
      syncState: sessionRef.current ? 'pending' : 'local',
      updatedAt: Date.now(),
    })
  }, [])

  const handleCollectionChange = useCallback((id: string, collectionId: number | null) => {
    const entry = historyRef.current.find((e) => e.id === id)
    if (!entry) return
    storeRef.current.upsert({
      ...entry,
      collectionId,
      syncState: sessionRef.current ? 'pending' : 'local',
      updatedAt: Date.now(),
    })
  }, [])

  /** 「导出全部为 JSON」：不做服务端备份之后用户手里唯一的兜底（§10 风险 5） */
  const handleExport = useCallback(() => {
    const data = historyRef.current.map((s) => ({
      id: s.id,
      kind: s.kind ?? 'command',
      title: s.title,
      content: s.content,
      langId: s.langId,
      pinned: s.pinned === true,
      localOnly: s.localOnly === true,
      tags: s.tags ?? [],
      createdAt: new Date(s.createdAt).toISOString(),
      updatedAt: new Date(s.updatedAt).toISOString(),
    }))
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), snippets: data }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vimpaste-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出 JSON 文件', 'ok')
  }, [showToast])

  // —— 集合管理（云端模式；运行时动态 import 云模块）——
  const refreshCollections = useCallback(async () => {
    if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
    const { cloudApi } = await import('./cloud/api')
    setCollections(await cloudApi.collections())
  }, [])

  const handleCreateCollection = useCallback(
    async (name: string) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      try {
        const { cloudApi } = await import('./cloud/api')
        await cloudApi.createCollection(name)
        await refreshCollections()
      } catch (e) {
        showToast(e instanceof Error ? e.message : '集合创建失败', 'err')
      }
    },
    [refreshCollections, showToast],
  )

  const handleRenameCollection = useCallback(
    async (id: number, name: string) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      try {
        const { cloudApi } = await import('./cloud/api')
        await cloudApi.renameCollection(id, name)
        await refreshCollections()
      } catch (e) {
        showToast(e instanceof Error ? e.message : '集合重命名失败', 'err')
      }
    },
    [refreshCollections, showToast],
  )

  const handleDeleteCollection = useCallback(
    async (id: number) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      try {
        const { cloudApi } = await import('./cloud/api')
        await cloudApi.deleteCollection(id)
        await refreshCollections()
        setActiveCollectionId((prev) => (prev === id ? null : prev))
      } catch (e) {
        showToast(e instanceof Error ? e.message : '集合删除失败', 'err')
      }
    },
    [refreshCollections, showToast],
  )

  // —— 云端会话接线（对话框回调）——
  const handleSessionReady = useCallback((session: CloudSession, nextCollections: ApiCollection[]) => {
    sessionRef.current = session
    setCloudSession(session)
    setCloudUser(session.user)
    setSyncStatus(session.engine.currentStatus())
    setStore(session.store)
    setCollections(nextCollections)
  }, [])

  const handleLogout = useCallback(async () => {
    if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
    const session = sessionRef.current
    sessionRef.current = null
    setCloudSession(null)
    setCloudUser(null)
    setCollections([])
    setActiveCollectionId(null)
    setSyncStatus({ state: 'idle', lastSyncAt: null })
    if (session) await session.destroy()
    const { localStoreAfterLogout } = await import('./cloud/session')
    setStore(localStoreAfterLogout())
  }, [])

  const handleRetrySync = useCallback(() => {
    sessionRef.current?.engine.retryNow()
  }, [])

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

  /** 填充并复制（§8 Phase 6）：只影响复制内容，原文不动；记住本次填的值（仅本地） */
  const handleFillAndCopy = useCallback(async () => {
    const entry = activeEntry
    if (!entry) return
    rememberVarValues(entry.id, varValues)
    const filled = fillPromptTemplate(entry.content, varValues)
    const channel = await copyText(filled)
    if (channel === 'failed') {
      showCopyFeedback({ kind: 'err', text: '复制失败，请手动全选后按 Ctrl/Cmd+C', note: '' })
      return
    }
    showToast(`已按变量填充并复制（${filled.length} 字符）`, 'ok')
  }, [activeEntry, varValues, showCopyFeedback, showToast])

  const handleVarChange = useCallback((name: string, value: string) => {
    setVarValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  // 活动条目切换时恢复该条目各变量的上次填写值（仅本地记忆）。
  // 渲染期重置模式：只跟随 entry.id（内容变化不重置，避免清掉正在输入的值）
  const [varEntryId, setVarEntryId] = useState<string | null>(activeEntry?.id ?? null)
  if (varEntryId !== (activeEntry?.id ?? null)) {
    setVarEntryId(activeEntry?.id ?? null)
    const entry = activeEntry
    const names =
      entry && (entry.kind ?? 'command') === 'prompt' ? parsePromptVariables(entry.content) : []
    setVarValues(lastVarValues(entry?.id ?? '', names))
  }

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

  const filteredByCollection = activeCollectionId === null
    ? history
    : history.filter((s) => s.collectionId === activeCollectionId)

  const cloudStatusView: CloudStatusView | undefined =
    import.meta.env.VITE_CLOUD_ENABLED === 'true'
      ? {
          loggedIn: cloudUser !== null,
          syncing: syncStatus.state === 'syncing',
          paused: syncStatus.state === 'paused',
          lastSyncLabel:
            syncStatus.lastSyncAt === null ? null : formatRelativeTime(syncStatus.lastSyncAt),
        }
      : undefined

  const isPrompt = editorKind === 'prompt'
  const promptVarNames = useMemo(
    () => (activeEntry && (activeEntry.kind ?? 'command') === 'prompt' ? parsePromptVariables(activeEntry.content) : []),
    [activeEntry],
  )

  return (
    <div className="app">
      <Toolbar
        langId={langId}
        langAuto={!manualOverride}
        manualOverride={manualOverride}
        onLanguageChange={handleLanguageChange}
        promptMode={isPrompt}
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
        cloudEnabled={import.meta.env.VITE_CLOUD_ENABLED === 'true'}
        accountLabel={cloudUser ? cloudUser.email.split('@')[0] : null}
        onOpenAccount={() => setAccountOpen(true)}
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
            entries={filteredByCollection}
            enabled={historyEnabled}
            activeId={activeEntryId}
            onClose={() => setHistoryPanelOpen(false)}
            onOpenEntry={handleOpenEntry}
            onDeleteEntry={handleDeleteEntry}
            onClearAll={handleClearHistory}
            onToggleEnabled={handleHistoryEnabledChange}
            onNewPaste={handleNewPaste}
            onNewPrompt={handleNewPrompt}
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            cloudMode={cloudUser !== null}
            collections={collections}
            activeCollectionId={activeCollectionId}
            onSelectCollection={setActiveCollectionId}
            onCreateCollection={handleCreateCollection}
            onRenameCollection={handleRenameCollection}
            onDeleteCollection={handleDeleteCollection}
            onTogglePin={handleTogglePin}
            onExport={handleExport}
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

          {activeEntry && (
            <EntryMetaBar
              entry={activeEntry}
              collections={collections}
              onTogglePin={handleTogglePin}
              onToggleLocalOnly={handleToggleLocalOnly}
              onTagsChange={handleTagsChange}
              onCollectionChange={handleCollectionChange}
            />
          )}

          {promptVarNames.length > 0 && (
            <VariableFillBar
              names={promptVarNames}
              values={varValues}
              onChange={handleVarChange}
              onFillAndCopy={() => void handleFillAndCopy()}
            />
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
        isPrompt={isPrompt}
        words={countWords(content)}
        tokensEstimate={estimateTokens(content.length)}
        cloudStatus={cloudStatusView}
        onCloudRetry={handleRetrySync}
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
          entries={filteredByCollection}
          enabled={historyEnabled}
          activeId={activeEntryId}
          // 抽屉的 Esc / 遮罩 / ✕ 关闭都只改瞬态，不写 historyPanelOpen
          onClose={() => setHistoryOpen(false)}
          onOpenEntry={handleOpenEntry}
          onDeleteEntry={handleDeleteEntry}
          onClearAll={handleClearHistory}
          onToggleEnabled={handleHistoryEnabledChange}
          onNewPaste={handleNewPaste}
          onNewPrompt={handleNewPrompt}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          cloudMode={cloudUser !== null}
          collections={collections}
          activeCollectionId={activeCollectionId}
          onSelectCollection={setActiveCollectionId}
          onCreateCollection={handleCreateCollection}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          onTogglePin={handleTogglePin}
          onExport={handleExport}
        />
      )}

      {AccountDialog && accountOpen && (
        <Suspense fallback={null}>
          <AccountDialog
            open
            onClose={() => setAccountOpen(false)}
            session={cloudSession}
            syncStatus={syncStatus}
            onStatus={setSyncStatus}
            onSessionReady={handleSessionReady}
            onLogout={handleLogout}
            onRetrySync={handleRetrySync}
          />
        </Suspense>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}
