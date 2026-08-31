import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { languageLabel } from '../detection/language'
import type { HistoryEntry } from '../storage/history'
import { formatRelativeTime, historyGroupLabel } from '../utils/time'
import { IconClose } from './icons'
export interface HistoryPanelProps {
  open: boolean
  /** docked：桌面端固定在左侧、参与布局；drawer：窄视口下覆盖式弹出抽屉 */
  variant: 'docked' | 'drawer'
  entries: HistoryEntry[]
  enabled: boolean
  /** 当前编辑器中已恢复（或正在编辑）的条目 */
  activeId: string | null
  onClose: () => void
  onOpenEntry: (id: string) => void
  onDeleteEntry: (id: string) => void
  onClearAll: () => void
  onToggleEnabled: (next: boolean) => void
  onNewPaste: () => void
}

interface HistoryGroup {
  label: string
  items: HistoryEntry[]
}

function groupEntries(entries: HistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const entry of entries) {
    const label = historyGroupLabel(entry.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(entry)
    else groups.push({ label, items: [entry] })
  }
  return groups
}

/** 粘贴历史面板：分组列表、搜索、悬停删除、清空确认、开关；桌面固定展示，窄视口为抽屉 */
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
  } = props

  const [query, setQuery] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
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
    if (!q) return entries
    return entries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q),
    )
  }, [entries, query])

  const groups = useMemo(() => groupEntries(filtered), [filtered])

  const handleClearAll = () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 4000)
      return
    }
    window.clearTimeout(clearTimer.current)
    setClearArmed(false)
    onClearAll()
  }

  if (!open) return null

  const content = (
    <>
      <header className="history-header">
        <h2 className="history-title">历史记录</h2>
        <span className="history-count">{entries.length} 条</span>
        <button
          type="button"
          className="btn ghost icon"
          aria-label="关闭历史面板"
          onClick={onClose}
        >
          <IconClose size={13} />
        </button>
      </header>

      <div className="history-actions">
        <button type="button" className="btn" onClick={onNewPaste}>
          ＋ 新建粘贴
        </button>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          <span>自动保存</span>
        </label>
      </div>

      {enabled ? (
        <>
          <div className="history-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="history-search"
              placeholder="搜索历史…"
              aria-label="搜索历史"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {entries.length === 0 ? (
            <div className="history-empty">
              暂无历史记录
              <br />
              粘贴内容后会自动保存在这里
            </div>
          ) : filtered.length === 0 ? (
            <div className="history-empty">没有匹配「{query.trim()}」的历史</div>
          ) : (
            <ul className="history-list">
              {groups.map((group) => (
                <Fragment key={group.label}>
                  <li className="history-group" aria-hidden="true">
                    {group.label}
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
                        <span className="history-item-meta">
                          {formatRelativeTime(entry.updatedAt)} · {languageLabel(entry.langId)} ·{' '}
                          {entry.content.length} 字符
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn icon history-item-delete"
                        aria-label={`删除「${entry.title}」`}
                        onClick={() => onDeleteEntry(entry.id)}
                      >
                        <IconClose size={12} />
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
          历史已关闭
          <br />
          打开「自动保存」后，粘贴内容会保存在本浏览器
        </div>
      )}

      <footer className="history-footer">
        <span>仅保存在本浏览器 · 不上传</span>
        {enabled && (
          <button
            type="button"
            className={`btn ${clearArmed ? 'danger' : 'ghost'}`}
            onClick={handleClearAll}
            aria-label={clearArmed ? '确认清空全部历史' : '清空全部历史'}
          >
            {clearArmed ? '确认清空？' : '清空全部'}
          </button>
        )}
      </footer>
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
