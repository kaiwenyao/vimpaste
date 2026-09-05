import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { languageLabel } from '../detection/language'
import type { Snippet, SnippetKind } from '../storage/snippets'
import { formatRelativeTime, historyGroupLabel } from '../utils/time'
import type { ApiCollection } from '../cloud/api'
import {
  IconClose,
  IconDownload,
  IconHistory,
  IconLock,
  IconPin,
  IconPlus,
  IconSearch,
  IconTrash,
} from './icons'

export type SnippetKindFilter = 'all' | SnippetKind

export interface HistoryPanelProps {
  open: boolean
  /** docked：桌面端固定在左侧、参与布局；drawer：窄视口下覆盖式弹出抽屉 */
  variant: 'docked' | 'drawer'
  entries: Snippet[]
  enabled: boolean
  /** 当前编辑器中已恢复（或正在编辑）的条目 */
  activeId: string | null
  onClose: () => void
  onOpenEntry: (id: string) => void
  onDeleteEntry: (id: string) => void
  onClearAll: () => void
  onToggleEnabled: (next: boolean) => void
  onNewPaste: () => void
  /** —— v2 新增（均为可选，匿名路径行为不变）—— */
  onNewPrompt?: () => void
  kindFilter?: SnippetKindFilter
  onKindFilterChange?: (filter: SnippetKindFilter) => void
  /** 云端模式：显示集合管理与同步说明（匿名路径保持「仅保存在本浏览器」） */
  cloudMode?: boolean
  collections?: ApiCollection[]
  activeCollectionId?: number | null
  onSelectCollection?: (id: number | null) => void
  onCreateCollection?: (name: string) => Promise<void>
  onRenameCollection?: (id: number, name: string) => Promise<void>
  onDeleteCollection?: (id: number) => Promise<void>
  onTogglePin?: (id: string) => void
  onExport?: () => void
}

interface HistoryGroup {
  label: string
  items: Snippet[]
}

/** 分组标题的英文副标：中文标题本身是稳定的可访问文本，英文只作装饰 */
const GROUP_EN: Record<string, string> = {
  今天: 'Today',
  昨天: 'Yesterday',
  '7 天内': 'This week',
  '30 天内': 'This month',
  更早: 'Earlier',
}

const KIND_FILTERS: { id: SnippetKindFilter; label: string; en: string }[] = [
  { id: 'all', label: '全部', en: 'All' },
  { id: 'command', label: '命令', en: 'Commands' },
  { id: 'prompt', label: 'Prompt', en: 'Prompts' },
]

const CLEAR_ARM_MS = 4000

function groupEntries(entries: Snippet[]): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const entry of entries) {
    const label = historyGroupLabel(entry.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(entry)
    else groups.push({ label, items: [entry] })
  }
  return groups
}

/** 片段库面板：分组列表、搜索、类型筛选、置顶/仅本地标记、集合管理；桌面固定，窄视口抽屉 */
export function HistoryPanel(props: HistoryPanelProps) {
  const {
    open,
    variant,
    entries,
    enabled,
    activeId,
    onClose,
    onOpenEntry,
    onDeleteEntry,
    onClearAll,
    onToggleEnabled,
    onNewPaste,
    onNewPrompt,
    kindFilter = 'all',
    onKindFilterChange,
    cloudMode = false,
    collections = [],
    activeCollectionId = null,
    onSelectCollection,
    onCreateCollection,
    onRenameCollection,
    onDeleteCollection,
    onTogglePin,
    onExport,
  } = props

  const [query, setQuery] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const clearTimer = useRef(0)

  // 仅抽屉形态在展开时聚焦搜索框；固定面板不打断编辑器焦点
  useEffect(() => {
    if (variant === 'drawer' && open && enabled) searchRef.current?.focus()
  }, [variant, open, enabled])

  // Esc 关闭只适用于抽屉；固定面板是常驻 UI，Esc 属于 Vim 模式按键，不能被吞掉
  useEffect(() => {
    if (variant !== 'drawer' || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(clearTimer.current)
    }
  }, [variant, open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries
    if (kindFilter !== 'all') list = list.filter((e) => (e.kind ?? 'command') === kindFilter)
    if (!q) return list
    return list.filter(
      (e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q),
    )
  }, [entries, query, kindFilter])

  // 置顶条目排到每组最前（updatedAt 分组内保持时间序，pin 提升到组首）
  const groups = useMemo(
    () =>
      groupEntries(filtered).map((g) => ({
        ...g,
        items: [...g.items.filter((e) => e.pinned), ...g.items.filter((e) => !e.pinned)],
      })),
    [filtered],
  )

  const handleClearAll = () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setClearArmed(false), CLEAR_ARM_MS)
      return
    }
    window.clearTimeout(clearTimer.current)
    setClearArmed(false)
    onClearAll()
  }

  const handleCreateCollection = async () => {
    const name = collectionName.trim()
    if (!name || !onCreateCollection) return
    setCollectionName('')
    await onCreateCollection(name)
  }

  const submitRename = async (id: number) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (name && onRenameCollection) await onRenameCollection(id, name)
  }

  if (!open) return null

  const content = (
    <>
      <header className="history-header">
        <h2 className="history-title">历史记录</h2>
        <span className="history-count">{entries.length} 条</span>
        <button
          type="button"
          className="btn ghost icon history-close"
          aria-label="关闭历史面板"
          onClick={onClose}
        >
          <IconClose size={13} />
        </button>
      </header>

      <button type="button" className="btn history-new" aria-label="新建粘贴" onClick={onNewPaste}>
        <IconPlus size={14} />
        <span aria-hidden="true">新建粘贴</span>
        <span className="en" aria-hidden="true">
          New paste
        </span>
      </button>

      {onNewPrompt && (
        <button
          type="button"
          className="btn history-new prompt"
          aria-label="新建 Prompt"
          onClick={onNewPrompt}
        >
          <IconPlus size={14} />
          <span aria-hidden="true">新建 Prompt</span>
          <span className="en" aria-hidden="true">
            New prompt
          </span>
        </button>
      )}

      {enabled ? (
        <>
          <div className="history-search-wrap">
            <IconSearch size={14} />
            <input
              ref={searchRef}
              type="text"
              className="history-search"
              placeholder="搜索历史 Search…"
              aria-label="搜索历史"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {onKindFilterChange && (
            <div className="history-kind-chips" role="group" aria-label="类型筛选">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip ${kindFilter === f.id ? 'active' : ''}`}
                  aria-pressed={kindFilter === f.id}
                  onClick={() => onKindFilterChange(f.id)}
                >
                  <span>{f.label}</span>
                  <span className="en" aria-hidden="true">
                    {f.en}
                  </span>
                </button>
              ))}
            </div>
          )}

          {cloudMode && (
            <div className="history-collections" aria-label="集合">
              <button
                type="button"
                className={`chip small ${activeCollectionId === null ? 'active' : ''}`}
                onClick={() => onSelectCollection?.(null)}
              >
                全部集合
              </button>
              {collections.map((c) => (
                <span key={c.id} className={`collection-chip ${activeCollectionId === c.id ? 'active' : ''}`}>
                  {renamingId === c.id ? (
                    <input
                      className="collection-rename"
                      aria-label="重命名集合"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => void submitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename(c.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="collection-name"
                      onClick={() => onSelectCollection?.(c.id)}
                      onDoubleClick={() => {
                        setRenamingId(c.id)
                        setRenameValue(c.name)
                      }}
                      title="点击筛选；双击重命名"
                    >
                      {c.name}
                    </button>
                  )}
                  <button
                    type="button"
                    className="collection-manage"
                    aria-label={`删除集合「${c.name}」`}
                    onClick={() => void onDeleteCollection?.(c.id)}
                  >
                    <IconClose size={9} />
                  </button>
                </span>
              ))}
              <span className="collection-create">
                <input
                  type="text"
                  className="collection-input"
                  placeholder="新建集合"
                  aria-label="新建集合名称"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateCollection()
                  }}
                />
              </span>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="history-empty">
              <span className="history-empty-mark" aria-hidden="true">
                <IconHistory size={24} />
              </span>
              <span>暂无历史记录</span>
              <span>
                粘贴内容后会自动保存在这里
                <br />
                <span className="en">Snapshots stay on this device</span>
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="history-empty">没有匹配「{query.trim()}」的历史</div>
          ) : (
            <ul className="history-list">
              {groups.map((group) => (
                <Fragment key={group.label}>
                  <li className="history-group" aria-hidden="true">
                    <span>{group.label}</span>
                    <span className="en">{GROUP_EN[group.label]}</span>
                  </li>
                  {group.items.map((entry) => (
                    <li
                      key={entry.id}
                      className={`history-row ${entry.id === activeId ? 'active' : ''}`}
                    >
                      <button
                        type="button"
                        className="history-item"
                        title={entry.title}
                        onClick={() => onOpenEntry(entry.id)}
                      >
                        <span className="history-item-title">{entry.title}</span>
                        <span className="history-item-meta-row">
                          <span className="history-item-meta">
                            {formatRelativeTime(entry.updatedAt)} · {languageLabel(entry.langId)} ·{' '}
                            {entry.content.length} 字符
                          </span>
                          {(entry.kind ?? 'command') === 'prompt' && (
                            <span className="tag kind-prompt" aria-label="类型：Prompt">
                              Prompt
                            </span>
                          )}
                          {entry.pinned === true && (
                            <span className="tag pinned" aria-label="已置顶">
                              <IconPin size={9} />
                            </span>
                          )}
                          {entry.localOnly === true && (
                            <span className="tag local-only" aria-label="仅本地，不同步">
                              <IconLock size={9} />
                              仅本地
                            </span>
                          )}
                          {entry.id === activeId && <span className="tag accent">编辑中</span>}
                        </span>
                      </button>
                      {onTogglePin && (
                        <button
                          type="button"
                          className={`btn icon history-item-pin ${entry.pinned ? 'on' : ''}`}
                          aria-label={entry.pinned ? `取消置顶「${entry.title}」` : `置顶「${entry.title}」`}
                          onClick={() => onTogglePin(entry.id)}
                        >
                          <IconPin size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn icon history-item-delete"
                        aria-label={`删除「${entry.title}」`}
                        onClick={() => onDeleteEntry(entry.id)}
                      >
                        <IconTrash size={13} />
                      </button>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="history-empty">
          <span className="history-empty-mark" aria-hidden="true">
            <IconHistory size={24} />
          </span>
          <span>历史已关闭</span>
          <span>打开「自动保存」后，粘贴内容会保存在本浏览器</span>
        </div>
      )}

      <footer className="history-footer">
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          <span>自动保存</span>
        </label>
        <span className="spacer" />
        {onExport && enabled && (
          <button type="button" className="btn ghost" onClick={onExport} aria-label="导出全部为 JSON">
            <IconDownload size={13} />
            <span aria-hidden="true">导出 JSON</span>
          </button>
        )}
        {enabled && (
          <button
            type="button"
            className={`btn ghost ${clearArmed ? 'danger' : ''}`}
            onClick={handleClearAll}
            aria-label={clearArmed ? '确认清空全部历史' : '清空全部历史'}
          >
            {clearArmed ? '确认清空？' : '清空全部'}
          </button>
        )}
      </footer>

      {cloudMode ? (
        <span className="history-note">已登录 · 同步到自托管服务器 · 敏感条目请开「仅本地」</span>
      ) : (
        <span className="history-note">仅保存在本浏览器 · 不上传</span>
      )}
    </>
  )

  if (variant === 'docked') {
    return (
      <aside className="history-panel docked" aria-label="粘贴历史">
        {content}
      </aside>
    )
  }

  return (
    <div
      className="history-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside className="history-panel drawer" role="dialog" aria-modal="true" aria-label="粘贴历史">
        {content}
      </aside>
    </div>
  )
}
