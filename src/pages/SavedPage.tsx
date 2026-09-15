import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { languageLabel } from '../detection/language'
import type { Snippet, SnippetKind } from '../storage/snippets'
import { formatRelativeTime, historyGroupLabel } from '../utils/time'
import type { ApiCollection, CollectionPatch } from '../cloud/api'
import { nextColor } from '../utils/collections'
import { CollectionFormDialog, ColorDot } from '../components/CollectionDialogs'
import { CollectionMoveMenu } from '../components/CollectionMoveMenu'
import { CollectionPanel } from '../components/CollectionPanel'
import {
  IconDownload,
  IconHistory,
  IconLock,
  IconPin,
  IconPlus,
  IconSearch,
  IconTerminal,
  IconTrash,
} from '../components/icons'

export type SnippetKindFilter = 'all' | SnippetKind

export interface SavedPageProps {
  entries: Snippet[]
  /** 当前编辑器中已打开的条目 */
  activeId: string | null
  onBack: () => void
  /** 点击条目行 → 详情页 */
  onOpenDetail: (id: string) => void
  onOpenInEditor: (id: string) => void
  onNewPaste: () => void
  onNewPrompt: () => void
  onDeleteEntry: (id: string) => void
  onClearAll: () => void
  onTogglePin: (id: string) => void
  onExport: () => void
  kindFilter: SnippetKindFilter
  onKindFilterChange: (filter: SnippetKindFilter) => void
  /** —— 云端模式（匿名路径不传）—— */
  cloudMode?: boolean
  collections?: ApiCollection[]
  activeCollectionId?: number | null
  onSelectCollection?: (id: number | null) => void
  /** 每个收藏夹的条目数（对全集计数，不随筛选变化） */
  collectionCounts?: Record<number, number>
  /** 片段库全部条目数（「全部收藏夹」一行的计数） */
  totalCount?: number
  /** 返回创建出的收藏夹：行内「新建收藏夹…」创建后要把条目直接移进去 */
  onCreateCollection?: (name: string, color: string) => Promise<ApiCollection | null>
  onUpdateCollection?: (id: number, patch: CollectionPatch) => Promise<void>
  onDeleteCollection?: (id: number) => Promise<void>
  /** 收藏夹排序：dir=-1 上移，1 下移 */
  onMoveCollection?: (id: number, dir: -1 | 1) => Promise<void>
  /** 把条目移到收藏夹（null = 未分类）：与编辑器条目栏共用同一条写回路径 */
  onMoveEntry?: (entryId: string, collectionId: number | null) => void
}

interface SavedGroup {
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

/** 匿名模式（不传云端回调）下的占位实现，省掉满屏的非空断言 */
const noopCreate = async (): Promise<ApiCollection | null> => null
const noopAsync = async (): Promise<void> => {}

function groupEntries(entries: Snippet[]): SavedGroup[] {
  const groups: SavedGroup[] = []
  for (const entry of entries) {
    const label = historyGroupLabel(entry.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(entry)
    else groups.push({ label, items: [entry] })
  }
  return groups
}

/**
 * 「已保存」页面：手动保存进片段库的全部条目。
 * 列表按时间分组，点击条目进入详情页；行内提供 恢复到编辑器 / 置顶 / 删除。
 */
export function SavedPage(props: SavedPageProps) {
  const {
    entries,
    activeId,
    onBack,
    onOpenDetail,
    onOpenInEditor,
    onNewPaste,
    onNewPrompt,
    onDeleteEntry,
    onClearAll,
    onTogglePin,
    onExport,
    cloudMode = false,
    collections = [],
    activeCollectionId = null,
    onSelectCollection,
    collectionCounts = {},
    totalCount = 0,
    onCreateCollection,
    onUpdateCollection,
    onDeleteCollection,
    onMoveCollection,
    onMoveEntry,
    kindFilter,
    onKindFilterChange,
  } = props

  const [query, setQuery] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  /** 行内「新建收藏夹…」：创建成功后把这条片段移进新收藏夹 */
  const [createForEntry, setCreateForEntry] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const clearTimer = useRef(0)

  useEffect(
    () => () => {
      window.clearTimeout(clearTimer.current)
    },
    [],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries
    if (kindFilter !== 'all') list = list.filter((e) => (e.kind ?? 'command') === kindFilter)
    if (!q) return list
    return list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (e.note ?? '').toLowerCase().includes(q),
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

  return (
    <div className="page saved-page">
      <header className="page-topbar">
        <button type="button" className="btn ghost" aria-label="返回编辑器" onClick={onBack}>
          ← <span aria-hidden="true">编辑器</span>
          <span className="en" aria-hidden="true">
            Editor
          </span>
        </button>
        <h1 className="page-title">已保存</h1>
        <span className="page-count">{entries.length} 条</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn history-new"
          aria-label="新建粘贴"
          onClick={onNewPaste}
        >
          <IconPlus size={14} />
          <span aria-hidden="true">新建粘贴</span>
          <span className="en" aria-hidden="true">
            New paste
          </span>
        </button>
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
      </header>

      <div className="history-search-wrap">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          type="text"
          className="history-search"
          placeholder="搜索已保存片段 Search…"
          aria-label="搜索已保存片段"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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

      {cloudMode && (
        <CollectionPanel
          collections={collections}
          counts={collectionCounts}
          totalCount={totalCount}
          activeId={activeCollectionId}
          onSelect={(id) => onSelectCollection?.(id)}
          onCreate={onCreateCollection ?? noopCreate}
          onUpdate={onUpdateCollection ?? noopAsync}
          onDelete={onDeleteCollection ?? noopAsync}
          onMove={onMoveCollection ?? noopAsync}
        />
      )}

      {entries.length === 0 ? (
        <div className="history-empty">
          <span className="history-empty-mark" aria-hidden="true">
            <IconHistory size={24} />
          </span>
          {activeCollectionId !== null ? (
            <>
              <span>这个收藏夹还是空的</span>
              <span>
                选中条目行右侧的文件夹图标可以把它移动进来
                <br />
                <span className="en">Move items here from the library</span>
              </span>
            </>
          ) : (
            <>
              <span>还没有保存过任何内容</span>
              <span>
                在编辑器里点「保存」（Ctrl/Cmd+S）后，条目会出现在这里
                <br />
                <span className="en">Save manually from the editor</span>
              </span>
            </>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="history-empty">没有匹配「{query.trim()}」的片段</div>
      ) : (
        <ul className="history-list saved-list">
          {groups.map((group) => (
            <Fragment key={group.label}>
              <li className="history-group" aria-hidden="true">
                <span>{group.label}</span>
                <span className="en">{GROUP_EN[group.label]}</span>
              </li>
              {group.items.map((entry) => {
                const collection = collections.find((c) => c.id === entry.collectionId) ?? null
                return (
                  <li
                    key={entry.id}
                    className={`history-row ${entry.id === activeId ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="history-item"
                      title={`${entry.title}（查看详情）`}
                      onClick={() => onOpenDetail(entry.id)}
                    >
                      <span className="history-item-title">{entry.title}</span>
                      {entry.note && <span className="history-item-note">{entry.note}</span>}
                      <span className="history-item-meta-row">
                        <span className="history-item-meta">
                          {formatRelativeTime(entry.updatedAt)} · {languageLabel(entry.langId)} ·{' '}
                          {entry.content.length} 字符
                        </span>
                        {collection !== null && (
                          <span className="tag collection-tag" title={`收藏夹：${collection.name}`}>
                            <ColorDot color={collection.color} size={8} />
                            <span className="collection-tag-name">{collection.name}</span>
                          </span>
                        )}
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
                    {cloudMode && onMoveEntry && (
                      <CollectionMoveMenu
                        entryTitle={entry.title}
                        currentId={entry.collectionId ?? null}
                        collections={collections}
                        counts={collectionCounts}
                        onPick={(collectionId) => onMoveEntry(entry.id, collectionId)}
                        onCreateRequest={() => setCreateForEntry(entry.id)}
                      />
                    )}
                    <button
                      type="button"
                      className="btn icon history-item-open"
                      aria-label={`在编辑器中打开「${entry.title}」`}
                      title="在编辑器中打开"
                      onClick={() => onOpenInEditor(entry.id)}
                    >
                      <IconTerminal size={13} />
                    </button>
                    <button
                      type="button"
                      className={`btn icon history-item-pin ${entry.pinned ? 'on' : ''}`}
                      aria-label={
                        entry.pinned ? `取消置顶「${entry.title}」` : `置顶「${entry.title}」`
                      }
                      onClick={() => onTogglePin(entry.id)}
                    >
                      <IconPin size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn icon history-item-delete"
                      aria-label={`删除「${entry.title}」`}
                      onClick={() => onDeleteEntry(entry.id)}
                    >
                      <IconTrash size={13} />
                    </button>
                  </li>
                )
              })}
            </Fragment>
          ))}
        </ul>
      )}

      <footer className="history-footer">
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onExport} aria-label="导出全部为 JSON">
          <IconDownload size={13} />
          <span aria-hidden="true">导出 JSON</span>
        </button>
        <button
          type="button"
          className={`btn ghost ${clearArmed ? 'danger' : ''}`}
          onClick={handleClearAll}
          aria-label={clearArmed ? '确认清空全部片段' : '清空全部片段'}
          disabled={entries.length === 0}
        >
          {clearArmed ? '确认清空？' : '清空全部'}
        </button>
      </footer>

      {cloudMode ? (
        <span className="history-note">已登录 · 同步到自托管服务器 · 敏感条目请开「仅本地」</span>
      ) : (
        <span className="history-note">仅保存在本浏览器 · 不上传</span>
      )}

      {/* 行内「新建收藏夹…」：创建成功后直接把该条目移进去，少一次来回 */}
      {createForEntry !== null && (
        <CollectionFormDialog
          collection={null}
          defaultColor={nextColor(collections)}
          onClose={() => setCreateForEntry(null)}
          onSubmit={async ({ name, color }) => {
            const created = await onCreateCollection?.(name, color)
            if (created) onMoveEntry?.(createForEntry, created.id)
          }}
        />
      )}
    </div>
  )
}
