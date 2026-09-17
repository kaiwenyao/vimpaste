import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeMirrorEditor } from './components/CodeMirrorEditor'
import { EntryMetaBar, NewSnippetBar, VariableFillBar } from './components/EntryBar'
import { HelpDialog } from './components/HelpDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import type { CloudStatusView } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { IconCheck, IconClose } from './components/icons'
import { Dialog } from './components/Dialog'
import type { LangId } from './detection/language'
import { detectLanguage, languageLabel } from './detection/language'
import { fillPromptTemplate, parsePromptVariables } from './detection/placeholders'
import type { EditorApi } from './editor/createEditor'
import { isEditorMode, normalizeFontSize } from './editor/editorMode'
import type { EditorMode } from './editor/editorMode'
import { jumpToPlaceholder } from './editor/navigation'
import type { CloudSession } from './cloud/session'
import type { SyncStatus } from './cloud/sync'
import type { ApiCollection, ApiSnippet, CollectionPatch } from './cloud/api'
import { countByCollection, planCollectionMove } from './utils/collections'
import type { Snippet, SnippetKind } from './storage/snippets'
import {
  LOCAL_SNIPPET_STORAGE,
  MAX_TAGS_PER_SNIPPET,
  MAX_TAG_CHARS,
  SNIPPET_NOTE_MAX_CHARS,
  SNIPPET_TITLE_MAX_CHARS,
  TRASH_RETENTION_DAYS,
  trashedSnippets,
} from './storage/snippets'
import { LocalSnippetStore } from './storage/SnippetStore'
import type { SnippetStore } from './storage/SnippetStore'
import { loadPrefs, savePrefs } from './storage/prefs'
import { createHistoryId, deriveTitle } from './storage/history'
import { SAVED_PATH, TRASH_PATH, navigate, useHashRoute } from './router'
import { SavedPage } from './pages/SavedPage'
import type { SnippetKindFilter } from './pages/SavedPage'
import { SnippetDetailPage } from './pages/SnippetDetailPage'
import { TrashPage } from './pages/TrashPage'
import { mergeTrashEntries } from './utils/trash'
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
/** 标签页标题基线：与 index.html 的 <title> 一致，未保存时前面加 ● 标记 */
const BASE_TITLE = 'VimPaste — 支持 Vim 的临时代码编辑器'
/** 未保存标记：浏览器标签页上提示「这里还有没入库的内容」 */
const DIRTY_MARK = '●'

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

/** default 收藏夹的 id：新片段未明确选择收藏夹时的保存落点（不存在时为 null） */
function defaultCollectionId(collections: ApiCollection[]): number | null {
  return collections.find((c) => c.name === 'default')?.id ?? null
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
  const [store, setStore] = useState<SnippetStore>(
    () => new LocalSnippetStore(LOCAL_SNIPPET_STORAGE),
  )
  const [library, setLibrary] = useState<Snippet[]>(() => alive(store.current()))
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [editorKind, setEditorKind] = useState<SnippetKind>('command')
  /** 新片段的标题/备注草稿：仅在新片段（未关联条目）阶段收集，随下一次保存入库 */
  const [newTitle, setNewTitle] = useState('')
  const [newNote, setNewNote] = useState('')
  /** 新片段的目标收藏夹草稿：'auto' = 未选择（保存时落 default 收藏夹） */
  const [newCollectionId, setNewCollectionId] = useState<number | null | 'auto'>('auto')
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
  /** 本地墓碑（未登录时的回收站内容；登录后是「还没送达服务端」的那些） */
  const [trashedLocal, setTrashedLocal] = useState<Snippet[]>(() =>
    trashedSnippets(store.current()),
  )
  /** 登录模式下服务端回收站（权威列表 + 服务端保留天数） */
  const [serverTrash, setServerTrash] = useState<{
    items: ApiSnippet[]
    retentionDays: number
  } | null>(null)
  const [trashError, setTrashError] = useState<string | null>(null)
  /**
   * 仍存活且标为「仅本地」的条目 id：服务端上它们只剩墓碑（其它设备的删除信号），
   * 但本机没删它们，因此不进回收站。
   */
  const [localOnlyAliveIds, setLocalOnlyAliveIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  /** 有未保存修改时的继续动作：确认对话框背后的那一步（打开条目 / 新建…） */
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)

  const toastTimer = useRef(0)
  const clearTimer = useRef(0)
  const copyTimer = useRef(0)

  // 保存/守卫需要读取最新值，用 ref 镜像状态（回调里避免闭包过期）
  const libraryRef = useRef(library)
  const contentRef = useRef(content)
  const langIdRef = useRef(langId)
  const activeEntryIdRef = useRef<string | null>(activeEntryId)
  const editorKindRef = useRef(editorKind)
  const newTitleRef = useRef('')
  const newNoteRef = useRef('')
  const newCollectionRef = useRef<number | null | 'auto'>('auto')
  const storeRef = useRef(store)
  const sessionRef = useRef<CloudSession | null>(null)
  const collectionsRef = useRef<ApiCollection[]>([])
  /** 从片段库跳回编辑器时是否自动聚焦（仅导航触发，刷新不聚焦） */
  const pendingFocusRef = useRef(false)

  useEffect(() => {
    libraryRef.current = library
  }, [library])
  useEffect(() => {
    langIdRef.current = langId
  }, [langId])
  useEffect(() => {
    activeEntryIdRef.current = activeEntryId
  }, [activeEntryId])
  useEffect(() => {
    editorKindRef.current = editorKind
  }, [editorKind])
  useEffect(() => {
    storeRef.current = store
  }, [store])
  useEffect(() => {
    sessionRef.current = cloudSession
  }, [cloudSession])
  useEffect(() => {
    collectionsRef.current = collections
  }, [collections])

  // store 换绑（登录 / 登出）或条目变化：同步快照到 React 状态（墓碑不进片段库列表）
  useEffect(() => {
    // 打开应用 / 换绑 store 时先清掉到期墓碑：本地路径没有定时任务，
    // 惰性清理是「30 天后自动删除」在本地的落地方式（服务端另有每日硬删任务）
    store.purgeExpired()
    const apply = (list: Snippet[]) => {
      libraryRef.current = alive(list)
      setLibrary(libraryRef.current)
      setTrashedLocal(trashedSnippets(list))
      setLocalOnlyAliveIds(
        new Set(list.filter((s) => s.localOnly === true && s.deletedAt == null).map((s) => s.id)),
      )
    }
    apply(store.current())
    return store.subscribe(apply)
  }, [store])

  /** 活动条目（编辑器里打开的那条） */
  const activeEntry = library.find((e) => e.id === activeEntryId) ?? null

  // —— 新片段的标题/备注草稿 ——（refs 供 commitSnapshot 读取，避免闭包过期）
  const resetNewMeta = useCallback(() => {
    newTitleRef.current = ''
    newNoteRef.current = ''
    newCollectionRef.current = 'auto'
    setNewTitle('')
    setNewNote('')
    setNewCollectionId('auto')
  }, [])
  const handleNewTitleChange = useCallback((title: string) => {
    newTitleRef.current = title
    setNewTitle(title)
  }, [])
  const handleNewNoteChange = useCallback((note: string) => {
    newNoteRef.current = note
    setNewNote(note)
  }, [])
  const handleNewCollectionChange = useCallback((collectionId: number | null) => {
    newCollectionRef.current = collectionId
    setNewCollectionId(collectionId)
  }, [])

  // —— 手动保存模型 ——
  // 内容只有点「保存」（或 Ctrl/Cmd+S）才进片段库：非空且与活动条目不一致即为未保存
  const dirty = content.trim() !== '' && (activeEntry === null || activeEntry.content !== content)
  const computeDirty = useCallback((): boolean => {
    const text = contentRef.current
    if (text.trim() === '') return false
    const active = libraryRef.current.find((e) => e.id === activeEntryIdRef.current)
    return !active || active.content !== text
  }, [])

  // —— 视图路由（#/ 编辑器 · #/saved 片段库 · #/saved/:id 详情）——
  const route = useHashRoute()

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
        /* 收藏夹加载失败不阻塞编辑，下次登录/同步时重试 */
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

  // 语法高亮跟随语言：识别或手动选择变化时把对应语言包装进编辑器
  // （prompt 形态由 setKind 固定轻高亮；须声明在 setKind 之后，语言包晚于类型重配置落地）
  useEffect(() => {
    void editorRef.current?.setLanguage(langId)
  }, [langId])

  // 应用编辑器键位模式到编辑器实例（编辑器内部对未变化的 mode 提前返回）
  useEffect(() => {
    editorRef.current?.setEditorMode(editorMode)
  }, [editorMode])

  // 持久化非敏感偏好（编辑内容只随片段功能保存在片段库存储键中）
  useEffect(() => {
    savePrefs({
      ...loadPrefs(),
      editorMode,
      fontSize,
      hintDismissed,
      theme,
    })
  }, [editorMode, fontSize, hintDismissed, theme])

  // 颜色主题：同步到 <html data-theme>，样式全部由 CSS 变量驱动
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 未保存标记进标签页标题：切到别的标签页也能一眼看出这里还有没入库的内容
  useEffect(() => {
    document.title = dirty ? `${DIRTY_MARK} ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [dirty])

  // 有未保存修改时离开页面（关闭/刷新/外链）浏览器弹原生确认；无修改时不打扰
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 旧浏览器靠 returnValue 字符串判断是否弹窗，新规范只看 preventDefault
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // 字体大小：通过 CSS 变量即时生效
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`)
  }, [fontSize])

  // 从片段库/详情页回到编辑器：视图重新可见后重测量并按需聚焦
  useEffect(() => {
    if (route.view !== 'editor') return
    editorRef.current?.view.requestMeasure()
    if (pendingFocusRef.current) {
      pendingFocusRef.current = false
      editorRef.current?.view.focus()
    }
  }, [route.view])

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

  const handleDocChanged = useCallback(
    (text: string) => {
      contentRef.current = text
      setContent(text)
      // 一旦继续编辑，「已复制」的三处反馈立即收起——绿色描边不能停留在已被改动的内容上
      window.clearTimeout(copyTimer.current)
      setCopyFeedback(null)
      if (text === '') {
        setManualOverride(false)
        setPlaceholderCount(0)
        // 清空编辑器即开始新的粘贴：与片段条目解除关联（条目本身保留）
        activeEntryIdRef.current = null
        setActiveEntryId(null)
        resetNewMeta()
      }
    },
    [resetNewMeta],
  )

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

  /** 手动保存：把当前编辑器内容写入/更新片段条目（新建或续写当前条目；与最近一条相同则复用）。
   *  新片段栏里的标题/备注与目标收藏夹随保存一起入库；已有条目的自定义标题不被自动标题覆盖。 */
  const commitSnapshot = useCallback(() => {
    const text = contentRef.current
    if (text.trim() === '') return
    const now = Date.now()
    const current = libraryRef.current
    const prevId = activeEntryIdRef.current
    const kind = editorKindRef.current
    const langForKind: LangId =
      kind === 'prompt'
        ? langIdRef.current === 'markdown'
          ? 'markdown'
          : 'plaintext'
        : langIdRef.current
    const draftTitle = newTitleRef.current.trim().slice(0, SNIPPET_TITLE_MAX_CHARS)
    const draftNote = newNoteRef.current.trim().slice(0, SNIPPET_NOTE_MAX_CHARS)
    // 目标收藏夹：'auto' = 用户没碰过选择器，落 default 收藏夹（不存在则不入夹）
    const draftCollectionId =
      newCollectionRef.current === 'auto'
        ? defaultCollectionId(collectionsRef.current)
        : newCollectionRef.current
    // 「新片段」栏里填了标题/备注 = 用户在给一条新片段起名：此时即使内容与最近一条
    // 已保存条目完全相同，也不走「复用最近一条」的去重回退——否则草稿元信息会覆盖
    // 旧条目的标题/备注，与 UI 承诺的新片段相悖（草稿为空时去重行为不变）。
    const hasDraftMeta = draftTitle !== '' || draftNote !== ''
    const target =
      (prevId ? current.find((e) => e.id === prevId) : undefined) ??
      (!hasDraftMeta && current[0] && current[0].content === text ? current[0] : undefined)
    // 自定义标题的不变量：从未改过标题的条目恒有 title === deriveTitle(content)。
    // 据此保存内容时保留用户起的名字，只让自动标题跟随新内容；新片段栏的草稿标题优先。
    const title =
      draftTitle !== ''
        ? draftTitle
        : target && target.title !== deriveTitle(target.content)
          ? target.title
          : deriveTitle(text)
    const note = draftNote !== '' ? draftNote : target?.note
    const entry: Snippet = target
      ? {
          ...target,
          content: text,
          langId: (target.kind ?? 'command') === 'prompt' ? langForKind : langIdRef.current,
          title,
          ...(note !== undefined ? { note } : {}),
          updatedAt: now,
          syncState: sessionRef.current ? 'pending' : 'local',
        }
      : {
          id: createHistoryId(),
          title,
          content: text,
          ...(note !== undefined ? { note } : {}),
          langId: langForKind,
          collectionId: draftCollectionId,
          createdAt: now,
          updatedAt: now,
          kind,
          syncState: sessionRef.current ? 'pending' : 'local',
        }
    activeEntryIdRef.current = entry.id
    setActiveEntryId(entry.id)
    resetNewMeta()
    storeRef.current.upsert(entry)
  }, [resetNewMeta])

  /** 「保存」按钮 / Ctrl+Cmd+S：唯一的入库入口（toast 文案跟着去向走：新建 vs 更新） */
  const handleSave = useCallback(() => {
    if (contentRef.current.trim() === '') return
    const existing = activeEntryIdRef.current !== null
    commitSnapshot()
    showToast(existing ? '已保存修改到当前片段' : '已保存为新片段', 'ok')
  }, [commitSnapshot, showToast])

  // Ctrl/Cmd+S 手动保存（capture 前于编辑器/浏览器默认行为，且仅在确有修改时生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        if (computeDirty()) handleSave()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [computeDirty, handleSave])

  /** 有未保存修改时先确认再继续；无修改直接放行 */
  const guardUnsaved = useCallback(
    (run: () => void) => {
      if (computeDirty()) setPendingNav(() => run)
      else run()
    },
    [computeDirty],
  )

  /** 把条目载入编辑器（不做保存——未保存的修改由确认对话框把关） */
  const loadEntryIntoEditor = useCallback(
    (id: string) => {
      const entry = libraryRef.current.find((e) => e.id === id)
      if (!entry) return
      activeEntryIdRef.current = id
      setActiveEntryId(id)
      resetNewMeta()
      const entryKind = entry.kind ?? 'command'
      setEditorKind(entryKind)
      setLangId(entryKind === 'prompt' && entry.langId !== 'markdown' ? 'plaintext' : entry.langId)
      setManualOverride(true)
      editorRef.current?.setDoc(entry.content)
      pendingFocusRef.current = true
      navigate('/')
    },
    [resetNewMeta],
  )

  const handleOpenEntry = useCallback(
    (id: string) => guardUnsaved(() => loadEntryIntoEditor(id)),
    [guardUnsaved, loadEntryIntoEditor],
  )

  /** 一次真实粘贴 = 一条新条目：粘贴时与当前条目解除关联（旧条目保留，保存后成为新条目） */
  const handleEditorPaste = useCallback(() => {
    if (activeEntryIdRef.current === null) return
    activeEntryIdRef.current = null
    setActiveEntryId(null)
    resetNewMeta()
  }, [resetNewMeta])

  const handleDeleteEntry = useCallback((id: string) => {
    // 删除进回收站（30 天内可恢复），不再立即消失。
    // 云端模式：store 的写透钩子会把这次删除入队，由同步引擎在服务端写墓碑
    storeRef.current.trash(id)
    if (activeEntryIdRef.current === id) {
      activeEntryIdRef.current = null
      setActiveEntryId(null)
    }
  }, [])

  /** 详情页删除：删除后回到片段列表 */
  const handleDeleteFromDetail = useCallback(
    (id: string) => {
      handleDeleteEntry(id)
      navigate(SAVED_PATH)
    },
    [handleDeleteEntry],
  )

  const handleClearHistory = useCallback(() => {
    // 清空片段库 = 全部进回收站（30 天内可恢复），不再直接抹掉内容。
    // 仅本地条目也在本地入回收站，但不会因此被推上服务器（store 不对 localOnly 触发删除钩子）
    storeRef.current.trashMany(libraryRef.current.map((s) => s.id))
    activeEntryIdRef.current = null
    setActiveEntryId(null)
    resetNewMeta()
  }, [resetNewMeta])

  /** 重新拉取服务端回收站（未登录时无事可做：本地回收站是同步读的） */
  const refreshTrash = useCallback(() => {
    if (cloudUser === null) return
    void (async () => {
      try {
        const { cloudApi } = await import('./cloud/api')
        const result = await cloudApi.trash()
        setServerTrash(result)
        setTrashError(null)
      } catch {
        // 拉不到就实话实说：不把空列表当成「回收站是空的」
        setTrashError('回收站加载失败，请检查网络后重试')
      }
    })()
  }, [cloudUser])

  /** 恢复：云端先请服务端清墓碑（失败要看得见），未登录直接本地恢复 */
  const handleRestoreFromTrash = useCallback(
    (id: string) => {
      const session = sessionRef.current
      if (session) {
        void (async () => {
          try {
            await session.engine.restoreFromTrash(id)
          } catch (error) {
            showToast(error instanceof Error ? error.message : '恢复失败，请稍后重试', 'err')
            return
          }
          refreshTrash()
          showToast('已恢复到片段库', 'ok')
        })()
        return
      }
      try {
        storeRef.current.restore(id)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '恢复失败，请稍后重试', 'err')
        return
      }
      showToast('已恢复到片段库', 'ok')
    },
    [refreshTrash, showToast],
  )

  /** 彻底删除：不可恢复，云端要求服务端立即物理删除 */
  const handlePurgeFromTrash = useCallback(
    (id: string) => {
      const session = sessionRef.current
      void (async () => {
        if (session) {
          try {
            await session.engine.purgeFromTrash(id)
          } catch (error) {
            showToast(error instanceof Error ? error.message : '彻底删除失败，请稍后重试', 'err')
            return
          }
        }
        storeRef.current.purge(id)
        refreshTrash()
        showToast('已彻底删除', 'ok')
      })()
    },
    [refreshTrash, showToast],
  )

  const handleEmptyTrash = useCallback(() => {
    const session = sessionRef.current
    void (async () => {
      if (session) {
        try {
          await session.engine.emptyTrashRemote()
        } catch (error) {
          showToast(error instanceof Error ? error.message : '清空失败，请稍后重试', 'err')
          return
        }
      }
      storeRef.current.emptyTrash()
      refreshTrash()
      showToast('回收站已清空', 'ok')
    })()
  }, [refreshTrash, showToast])

  // 进入回收站页面：登录模式下拉取服务端墓碑（本地模式直接读 store，不发请求）
  useEffect(() => {
    if (route.view !== 'trash' || cloudUser === null) return
    refreshTrash()
  }, [route.view, cloudUser, refreshTrash])

  /**
   * 登录 / 恢复会话后、以及每次同步完成后刷新服务端回收站。
   * 不刷新的话角标会说谎：本地墓碑在服务端确认删除后会被同步引擎从缓存里清掉，
   * 只算本地墓碑会让「回收站里有 2 条」显示成 0；另一台设备删的条目也不会出现。
   * 同步失败（paused）时不拉，避免断网时白发请求。
   */
  useEffect(() => {
    if (cloudUser === null || syncStatus.state === 'syncing' || syncStatus.state === 'paused')
      return
    refreshTrash()
  }, [cloudUser, syncStatus.state, refreshTrash])

  const handleNewPaste = useCallback(() => {
    guardUnsaved(() => {
      setEditorKind('command')
      // 从 prompt 形态切回：解除手动覆盖，语言识别重新接管（内容为空时归位纯文本）
      setManualOverride(false)
      setLangId((prev) => (prev === 'markdown' ? 'plaintext' : prev))
      activeEntryIdRef.current = null
      setActiveEntryId(null)
      resetNewMeta()
      editorRef.current?.setDoc('')
      pendingFocusRef.current = true
      navigate('/')
    })
  }, [guardUnsaved, resetNewMeta])

  /** 新建 Prompt：编辑器切到 prompt 形态（软换行 + {{变量}} 占位符），不识别语言 */
  const handleNewPrompt = useCallback(() => {
    guardUnsaved(() => {
      activeEntryIdRef.current = null
      setActiveEntryId(null)
      resetNewMeta()
      setEditorKind('prompt')
      setLangId('markdown')
      setManualOverride(true)
      editorRef.current?.setDoc('')
      pendingFocusRef.current = true
      navigate('/')
    })
  }, [guardUnsaved, resetNewMeta])

  /** 未保存确认对话框的三个去向 */
  const closePendingNav = useCallback(() => setPendingNav(null), [])
  const confirmSaveAndContinue = useCallback(() => {
    const run = pendingNav
    setPendingNav(null)
    if (!run) return
    handleSave()
    run()
  }, [pendingNav, handleSave])
  const confirmDiscard = useCallback(() => {
    const run = pendingNav
    setPendingNav(null)
    run?.()
  }, [pendingNav])

  const handleTogglePin = useCallback((id: string) => {
    const entry = libraryRef.current.find((e) => e.id === id)
    if (!entry) return
    storeRef.current.upsert({
      ...entry,
      pinned: !entry.pinned,
      syncState: sessionRef.current ? 'pending' : 'local',
    })
  }, [])

  /** 「仅本地」开关（§7.4）：已同步条目先向服务端发一次删除再转本地 */
  const handleToggleLocalOnly = useCallback((id: string) => {
    const entry = libraryRef.current.find((e) => e.id === id)
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

  /** 编辑已有片段的标题（立即入库，与标签同策略）：留空 = 恢复自动标题（取内容首行） */
  const handleTitleChange = useCallback((id: string, rawTitle: string) => {
    const entry = libraryRef.current.find((e) => e.id === id)
    if (!entry) return
    const title = rawTitle.trim().slice(0, SNIPPET_TITLE_MAX_CHARS) || deriveTitle(entry.content)
    if (title === entry.title) return
    storeRef.current.upsert({
      ...entry,
      title,
      syncState: sessionRef.current ? 'pending' : 'local',
      updatedAt: Date.now(),
    })
  }, [])

  /** 编辑已有片段的备注（立即入库）：留空 = 清除备注 */
  const handleNoteChange = useCallback((id: string, rawNote: string) => {
    const entry = libraryRef.current.find((e) => e.id === id)
    if (!entry) return
    const note = rawNote.trim().slice(0, SNIPPET_NOTE_MAX_CHARS)
    if (note === (entry.note ?? '')) return
    const next: Snippet = {
      ...entry,
      syncState: sessionRef.current ? 'pending' : 'local',
      updatedAt: Date.now(),
    }
    if (note === '') delete next.note
    else next.note = note
    storeRef.current.upsert(next)
  }, [])

  const handleTagsChange = useCallback((id: string, tags: string[]) => {
    const entry = libraryRef.current.find((e) => e.id === id)
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
    const entry = libraryRef.current.find((e) => e.id === id)
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
    const data = libraryRef.current.map((s) => ({
      id: s.id,
      kind: s.kind ?? 'command',
      title: s.title,
      content: s.content,
      ...(s.note ? { note: s.note } : {}),
      langId: s.langId,
      pinned: s.pinned === true,
      localOnly: s.localOnly === true,
      tags: s.tags ?? [],
      createdAt: new Date(s.createdAt).toISOString(),
      updatedAt: new Date(s.updatedAt).toISOString(),
    }))
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), snippets: data }, null, 2)],
      {
        type: 'application/json',
      },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vimpaste-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出 JSON 文件', 'ok')
  }, [showToast])

  // —— 收藏夹管理（云端模式；运行时动态 import 云模块）——
  // 这些回调不再自己 catch + toast：收藏夹的写操作全部发生在对话框里，
  // 失败信息（如重名 409「同名收藏夹已存在」）要就地显示在对话框内，而不是飘一条 toast。
  const refreshCollections = useCallback(async () => {
    if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
    const { cloudApi } = await import('./cloud/api')
    setCollections(await cloudApi.collections())
  }, [])

  const handleCreateCollection = useCallback(
    async (name: string, color: string): Promise<ApiCollection | null> => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return null
      const { cloudApi } = await import('./cloud/api')
      const created = await cloudApi.createCollection(name, color)
      await refreshCollections()
      return created
    },
    [refreshCollections],
  )

  const handleUpdateCollection = useCallback(
    async (id: number, patch: CollectionPatch) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      const { cloudApi } = await import('./cloud/api')
      await cloudApi.updateCollection(id, patch)
      await refreshCollections()
    },
    [refreshCollections],
  )

  /**
   * 上移 / 下移收藏夹：order 由 planCollectionMove 算出需要改动的条目（含重值归一下标），
   * 逐条 PATCH 后重新拉列表，界面顺序始终以服务端为准。
   */
  const handleMoveCollection = useCallback(
    async (id: number, dir: -1 | 1) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      const patches = planCollectionMove(collectionsRef.current, id, dir)
      if (patches.length === 0) return
      const { cloudApi } = await import('./cloud/api')
      for (const patch of patches) {
        await cloudApi.updateCollection(patch.id, { order: patch.order })
      }
      await refreshCollections()
    },
    [refreshCollections],
  )

  const handleDeleteCollection = useCallback(
    async (id: number) => {
      if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
      const { cloudApi } = await import('./cloud/api')
      await cloudApi.deleteCollection(id)
      await refreshCollections()
      setActiveCollectionId((prev) => (prev === id ? null : prev))
    },
    [refreshCollections],
  )

  // —— 云端会话接线（对话框回调）——
  const handleSessionReady = useCallback(
    (session: CloudSession, nextCollections: ApiCollection[]) => {
      sessionRef.current = session
      setCloudSession(session)
      setCloudUser(session.user)
      setSyncStatus(session.engine.currentStatus())
      setStore(session.store)
      setCollections(nextCollections)
      // 换账号登录：上一个账号的回收站绝不能留在界面上
      setServerTrash(null)
      setTrashError(null)
    },
    [],
  )

  const handleLogout = useCallback(async () => {
    if (import.meta.env.VITE_CLOUD_ENABLED !== 'true') return
    const session = sessionRef.current
    sessionRef.current = null
    setCloudSession(null)
    setCloudUser(null)
    setCollections([])
    setActiveCollectionId(null)
    setSyncStatus({ state: 'idle', lastSyncAt: null })
    // 服务端回收站列表属于上一个账号，登出即清掉
    setServerTrash(null)
    setTrashError(null)
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
    // 手动保存模型：复制不再入库，只提示字符数与未保存状态
    const channel = await copyText(content)
    const note = `${content.length} 字符${dirty ? ' · 尚未保存' : ''}`
    if (channel === 'clipboard') showCopyFeedback({ kind: 'ok', text: '已复制到剪贴板', note })
    else if (channel === 'fallback')
      showCopyFeedback({ kind: 'ok', text: '已复制（降级方式）', note })
    else
      showCopyFeedback({
        kind: 'err',
        text: '复制失败，请手动全选后按 Ctrl/Cmd+C',
        note: '',
      })
  }, [content, dirty, showCopyFeedback])

  /** 从详情页复制该条目的已保存内容 */
  const handleCopyEntry = useCallback(
    async (entry: Snippet) => {
      const channel = await copyText(entry.content)
      if (channel === 'failed') {
        showToast('复制失败，请手动全选后按 Ctrl/Cmd+C', 'err')
        return
      }
      showToast(`已复制「${entry.title}」（${entry.content.length} 字符）`, 'ok')
    },
    [showToast],
  )

  /** 填充并复制（§8 Phase 6）：只影响复制内容，原文不动；记住本次填的值（仅本地）。
   *  未保存的新 Prompt 也可填充（以编辑器当前内容为准，记忆挂在空 id 下） */
  const handleFillAndCopy = useCallback(async () => {
    const text = contentRef.current
    if (editorKindRef.current !== 'prompt' || text.trim() === '') return
    rememberVarValues(activeEntryIdRef.current ?? '', varValues)
    const filled = fillPromptTemplate(text, varValues)
    const channel = await copyText(filled)
    if (channel === 'failed') {
      showCopyFeedback({ kind: 'err', text: '复制失败，请手动全选后按 Ctrl/Cmd+C', note: '' })
      return
    }
    showToast(`已按变量填充并复制（${filled.length} 字符）`, 'ok')
  }, [varValues, showCopyFeedback, showToast])

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

  const filteredByCollection =
    activeCollectionId === null
      ? library
      : library.filter((s) => s.collectionId === activeCollectionId)

  // 收藏夹计数按全集算（不随当前筛选变化）：面板上的数字必须是「里面有多少条」
  const collectionCounts = useMemo(() => countByCollection(library), [library])

  /**
   * 回收站列表：未登录时全部来自本地墓碑；登录时以服务端墓碑为准，
   * 再并上本地还没送达服务端的那些（离线删的条目服务端根本不知道）。
   */
  const trashEntries = useMemo(
    () =>
      mergeTrashEntries(
        trashedLocal,
        cloudUser !== null ? (serverTrash?.items ?? null) : null,
        localOnlyAliveIds,
      ),
    [trashedLocal, serverTrash, cloudUser, localOnlyAliveIds],
  )
  // 保留天数取服务端配置（自托管可改 TOMBSTONE_RETENTION_DAYS），未登录用同一个默认值
  const trashRetentionDays = serverTrash?.retentionDays ?? TRASH_RETENTION_DAYS

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
  // 变量填充条跟随编辑器当前内容（不要求先保存）：prompt 形态下输入 {{变量}} 即出现
  const promptVarNames = useMemo(
    () => (isPrompt ? parsePromptVariables(content) : []),
    [isPrompt, content],
  )

  const detailEntry =
    route.view === 'detail' ? (library.find((e) => e.id === route.id) ?? null) : null

  const savedPage = (
    <SavedPage
      entries={filteredByCollection}
      activeId={activeEntryId}
      onBack={() => navigate('/')}
      onOpenDetail={(id) => navigate(`${SAVED_PATH}/${encodeURIComponent(id)}`)}
      onOpenInEditor={handleOpenEntry}
      onNewPaste={handleNewPaste}
      onNewPrompt={handleNewPrompt}
      onDeleteEntry={handleDeleteEntry}
      onClearAll={handleClearHistory}
      onTogglePin={handleTogglePin}
      onExport={handleExport}
      kindFilter={kindFilter}
      onKindFilterChange={setKindFilter}
      cloudMode={cloudUser !== null}
      collections={collections}
      activeCollectionId={activeCollectionId}
      onSelectCollection={setActiveCollectionId}
      collectionCounts={collectionCounts}
      totalCount={library.length}
      onCreateCollection={handleCreateCollection}
      onUpdateCollection={handleUpdateCollection}
      onDeleteCollection={handleDeleteCollection}
      onMoveCollection={handleMoveCollection}
      onMoveEntry={handleCollectionChange}
      onOpenTrash={() => navigate(TRASH_PATH)}
      trashCount={trashEntries.length}
    />
  )

  return (
    <div className="app">
      {/*
        编辑器常驻挂载（切到片段库/详情页时仅隐藏），保住 CodeMirror 的
        光标、撤销历史与滚动位置；「保存到片段库」只在编辑器视图有意义。
      */}
      <div className="editor-view" hidden={route.view !== 'editor'}>
        <Toolbar
          langId={langId}
          langAuto={!manualOverride}
          manualOverride={manualOverride}
          onLanguageChange={handleLanguageChange}
          promptMode={isPrompt}
          theme={theme}
          onThemeChange={handleThemeChange}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSaved={() => navigate(SAVED_PATH)}
          savedCount={library.length}
          saveState={content.trim() === '' ? 'empty' : dirty ? 'dirty' : 'saved'}
          saveTarget={activeEntry ? 'existing' : 'new'}
          saveTargetTitle={activeEntry ? activeEntry.title : newTitle}
          onSave={handleSave}
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
                dirty={dirty}
                collections={collections}
                onTogglePin={handleTogglePin}
                onToggleLocalOnly={handleToggleLocalOnly}
                onTagsChange={handleTagsChange}
                onCollectionChange={handleCollectionChange}
                onTitleChange={handleTitleChange}
                onNoteChange={handleNoteChange}
              />
            )}

            {activeEntry === null && content.trim() !== '' && (
              <NewSnippetBar
                title={newTitle}
                note={newNote}
                collections={collections}
                collectionId={
                  newCollectionId === 'auto' ? defaultCollectionId(collections) : newCollectionId
                }
                onCollectionChange={handleNewCollectionChange}
                onTitleChange={handleNewTitleChange}
                onNoteChange={handleNewNoteChange}
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
          saveState={content.trim() === '' ? undefined : dirty ? 'dirty' : 'saved'}
          saveTarget={activeEntry ? 'existing' : 'new'}
          saveTargetTitle={activeEntry ? activeEntry.title : newTitle}
          cloudStatus={cloudStatusView}
          onCloudRetry={handleRetrySync}
        />
      </div>

      {route.view === 'saved' && savedPage}

      {route.view === 'trash' && (
        <TrashPage
          entries={trashEntries}
          retentionDays={trashRetentionDays}
          loadError={cloudUser !== null ? trashError : null}
          cloudMode={cloudUser !== null}
          onRefresh={cloudUser !== null ? refreshTrash : undefined}
          onBack={() => navigate(SAVED_PATH)}
          onRestore={handleRestoreFromTrash}
          onPurge={handlePurgeFromTrash}
          onEmptyTrash={handleEmptyTrash}
        />
      )}

      {route.view === 'detail' &&
        (detailEntry !== null ? (
          <SnippetDetailPage
            entry={detailEntry}
            collections={collections}
            onBack={() => navigate(SAVED_PATH)}
            onOpenInEditor={handleOpenEntry}
            onCopy={(entry) => void handleCopyEntry(entry)}
            onTogglePin={handleTogglePin}
            onDelete={handleDeleteFromDetail}
            onMoveEntry={cloudUser !== null ? handleCollectionChange : undefined}
            onCreateCollection={cloudUser !== null ? handleCreateCollection : undefined}
          />
        ) : (
          <div className="page detail-page">
            <header className="page-topbar">
              <button
                type="button"
                className="btn ghost"
                aria-label="返回片段列表"
                onClick={() => navigate(SAVED_PATH)}
              >
                ← <span aria-hidden="true">片段库</span>
                <span className="en" aria-hidden="true">
                  Library
                </span>
              </button>
            </header>
            <div className="history-empty">
              <span>该条目不存在或已被删除</span>
            </div>
          </div>
        ))}

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

      <HelpDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        cloudMode={cloudUser !== null}
      />

      <Dialog open={pendingNav !== null} onClose={closePendingNav} title="有未保存的修改">
        <p className="confirm-text">编辑器里的内容还没有保存到片段库，继续操作将丢弃这些修改。</p>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={confirmSaveAndContinue}>
            保存并继续
          </button>
          <button type="button" className="btn danger" onClick={confirmDiscard}>
            不保存
          </button>
          <button type="button" className="btn ghost" onClick={closePendingNav}>
            取消
          </button>
        </div>
      </Dialog>

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
