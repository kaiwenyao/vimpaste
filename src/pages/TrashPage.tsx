import { Fragment, useEffect, useRef, useState } from 'react'
import type { TrashEntry } from '../utils/trash'
import { formatDaysLeft } from '../utils/trash'
import { HISTORY_GROUP_EN, formatRelativeTime, groupByHistoryLabel } from '../utils/time'
import { IconArrowRight, IconTrash } from '../components/icons'

const EMPTY_ARM_MS = 4000

export interface TrashPageProps {
  entries: TrashEntry[]
  /** 保留天数：云端用服务端回传值，未登录用默认 30 */
  retentionDays: number
  /** 云端模式下加载服务端回收站失败时的提示（本地模式恒为 null） */
  loadError?: string | null
  /** 是否走云端：页脚文案只在登录时说「从服务器一并抹掉」（匿名路径没有服务器） */
  cloudMode?: boolean
  /** 云端模式的「重试/刷新」，未登录不传（本地数据是同步读的，无需刷新） */
  onRefresh?: () => void
  onBack: () => void
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onEmptyTrash: () => void
}

/**
 * 回收站页面（#/trash）：按删除时间分组列出已删除的片段，
 * 可恢复或彻底删除，到期自动清除。
 *
 * 这里只说「还剩几天」，不说「30 天」——服务端保留天数可由自托管方配置，
 * 客户端只负责显示服务端告知的值。
 */
export function TrashPage(props: TrashPageProps) {
  const {
    entries,
    retentionDays,
    loadError = null,
    cloudMode = false,
    onRefresh,
    onBack,
    onRestore,
    onPurge,
    onEmptyTrash,
  } = props

  const [emptyArmed, setEmptyArmed] = useState(false)
  /** 正在等待二次确认的单条彻底删除 id：一次只能武装一行 */
  const [purgeArmedId, setPurgeArmedId] = useState<string | null>(null)
  const armTimer = useRef(0)
  const purgeTimer = useRef(0)

  useEffect(
    () => () => {
      window.clearTimeout(armTimer.current)
      window.clearTimeout(purgeTimer.current)
    },
    [],
  )

  // 与片段库同一套分组规则（今天 / 昨天 / 7 天内 / 30 天内 / 更早），只是按删除时间分组
  const groups = groupByHistoryLabel(entries, (entry) => entry.deletedAt)

  // 清空是不可恢复操作：与「清空全部片段」同一套两段式确认，避免误触
  const handleEmpty = () => {
    if (!emptyArmed) {
      setEmptyArmed(true)
      window.clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setEmptyArmed(false), EMPTY_ARM_MS)
      return
    }
    window.clearTimeout(armTimer.current)
    setEmptyArmed(false)
    onEmptyTrash()
  }

  // 单条彻底删除同样不可恢复：与「清空回收站」一致的两段式确认，误触还有后悔药
  const handlePurge = (id: string) => {
    if (purgeArmedId !== id) {
      setPurgeArmedId(id)
      window.clearTimeout(purgeTimer.current)
      purgeTimer.current = window.setTimeout(() => setPurgeArmedId(null), EMPTY_ARM_MS)
      return
    }
    window.clearTimeout(purgeTimer.current)
    setPurgeArmedId(null)
    onPurge(id)
  }

  return (
    <div className="page saved-page trash-page">
      <header className="page-topbar">
        <button type="button" className="btn ghost" aria-label="返回片段库" onClick={onBack}>
          ← <span aria-hidden="true">片段库</span>
          <span className="en" aria-hidden="true">
            Library
          </span>
        </button>
        <h1 className="page-title">回收站</h1>
        <span className="page-count">{entries.length} 条</span>
        <span className="spacer" />
        {onRefresh && (
          <button type="button" className="btn ghost" aria-label="刷新回收站" onClick={onRefresh}>
            <span aria-hidden="true">刷新</span>
            <span className="en" aria-hidden="true">
              Refresh
            </span>
          </button>
        )}
      </header>

      <p className="trash-note">
        删除的片段会在这里保留 {retentionDays} 天，到期自动清除；期间可以随时恢复。
        <br />
        <span className="en">Deleted items stay here and can be restored</span>
      </p>

      {loadError !== null && (
        <div className="trash-error" role="alert">
          {loadError}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="history-empty">
          <span className="history-empty-mark" aria-hidden="true">
            <IconTrash size={24} />
          </span>
          <span>回收站是空的</span>
          <span>
            在片段库里删除的条目会先来这里
            <br />
            <span className="en">Nothing in the bin</span>
          </span>
        </div>
      ) : (
        <ul className="history-list saved-list trash-list">
          {groups.map((group) => (
            <Fragment key={group.label}>
              <li className="history-group" aria-hidden="true">
                <span>{group.label}删除</span>
                <span className="en">{HISTORY_GROUP_EN[group.label]}</span>
              </li>
              {group.items.map((entry) => (
                <li key={entry.id} className="history-row trash-row">
                  <div className="history-item trash-item">
                    <span className="history-item-title">{entry.title}</span>
                    {entry.note && <span className="history-item-note">{entry.note}</span>}
                    <span className="history-item-meta-row">
                      <span className="history-item-meta">
                        删除于 {formatRelativeTime(entry.deletedAt)} ·{' '}
                        {formatDaysLeft(entry.deletedAt, retentionDays)} · {entry.content.length}{' '}
                        字符
                      </span>
                      {entry.pending && (
                        <span className="tag local-only" aria-label="尚未同步到服务器">
                          未同步
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost trash-restore"
                    aria-label={`恢复「${entry.title}」`}
                    title="恢复到片段库"
                    onClick={() => onRestore(entry.id)}
                  >
                    <IconArrowRight size={12} />
                    <span aria-hidden="true">恢复</span>
                  </button>
                  <button
                    type="button"
                    className={`btn icon history-item-delete ${
                      purgeArmedId === entry.id ? 'danger' : ''
                    }`}
                    aria-label={
                      purgeArmedId === entry.id
                        ? `确认彻底删除「${entry.title}」`
                        : `彻底删除「${entry.title}」`
                    }
                    title={purgeArmedId === entry.id ? '再点一次永久删除' : '彻底删除（不可恢复）'}
                    onClick={() => handlePurge(entry.id)}
                  >
                    <IconTrash size={13} />
                    {purgeArmedId === entry.id && <span aria-hidden="true">确认？</span>}
                  </button>
                </li>
              ))}
            </Fragment>
          ))}
        </ul>
      )}

      <footer className="history-footer">
        <span className="spacer" />
        <button
          type="button"
          className={`btn ghost ${emptyArmed ? 'danger' : ''}`}
          onClick={handleEmpty}
          aria-label={emptyArmed ? '确认清空回收站' : '清空回收站'}
          disabled={entries.length === 0}
        >
          {emptyArmed ? '确认清空？' : '清空回收站'}
        </button>
      </footer>

      <span className="history-note">
        {cloudMode
          ? '彻底删除与清空回收站都不可恢复，会立即从服务器一并抹掉'
          : '彻底删除与清空回收站都不可恢复'}
      </span>
    </div>
  )
}
