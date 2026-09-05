import { useEffect, useRef, useState, type ReactNode } from 'react'
import { languageLabel } from '../detection/language'
import type { Snippet } from '../storage/snippets'
import { countWords, estimateTokens } from '../utils/textStats'
import { formatFullTime, formatRelativeTime } from '../utils/time'
import type { ApiCollection } from '../cloud/api'
import {
  IconCheck,
  IconCopy,
  IconLock,
  IconPin,
  IconTerminal,
  IconTrash,
} from '../components/icons'

const CLEAR_ARM_MS = 4000

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** 同步状态的展示文案：匿名恒为 local；云端区分 已同步 / 待同步 */
function syncLabel(entry: Snippet): string {
  if (entry.localOnly) return '仅本地 · 不同步'
  if (entry.syncState === 'synced') return '已同步到云端'
  if (entry.syncState === 'pending') return '待同步'
  return '仅保存在本机'
}

export interface SnippetDetailPageProps {
  entry: Snippet
  collections: ApiCollection[]
  onBack: () => void
  onOpenInEditor: (id: string) => void
  /** App 统一处理复制（剪贴板降级 + 反馈提示） */
  onCopy: (entry: Snippet) => void
  onTogglePin: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * 条目详情页：展示一条已保存片段的完整元信息（类型、语言、统计、时间、标签、
 * 集合、同步状态）与全文，以及恢复到编辑器 / 复制 / 置顶 / 删除操作。
 */
export function SnippetDetailPage({
  entry,
  collections,
  onBack,
  onOpenInEditor,
  onCopy,
  onTogglePin,
  onDelete,
}: SnippetDetailPageProps) {
  const [clearArmed, setClearArmed] = useState(false)
  const clearTimer = useRef(0)

  // 切换到另一条详情时重置删除确认状态
  const [armedId, setArmedId] = useState(entry.id)
  if (armedId !== entry.id) {
    setArmedId(entry.id)
    setClearArmed(false)
  }

  useEffect(
    () => () => {
      window.clearTimeout(clearTimer.current)
    },
    [],
  )

  const handleDelete = () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setClearArmed(false), CLEAR_ARM_MS)
      return
    }
    window.clearTimeout(clearTimer.current)
    setClearArmed(false)
    onDelete(entry.id)
  }

  const lines = entry.content.split('\n').length
  const collection = collections.find((c) => c.id === entry.collectionId) ?? null
  const isPrompt = (entry.kind ?? 'command') === 'prompt'

  return (
    <div className="page detail-page">
      <header className="page-topbar">
        <button type="button" className="btn ghost" aria-label="返回片段列表" onClick={onBack}>
          ← <span aria-hidden="true">片段库</span>
          <span className="en" aria-hidden="true">
            Library
          </span>
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          aria-label="在编辑器中打开"
          onClick={() => onOpenInEditor(entry.id)}
        >
          <IconTerminal size={14} />
          <span aria-hidden="true">在编辑器中打开</span>
          <span className="en" aria-hidden="true">
            Open in editor
          </span>
        </button>
        <button
          type="button"
          className="btn ghost"
          aria-label="复制内容"
          onClick={() => onCopy(entry)}
        >
          <IconCopy size={14} />
          <span aria-hidden="true">复制</span>
        </button>
        <button
          type="button"
          className={`btn ghost ${entry.pinned ? 'sage' : ''}`}
          aria-label={entry.pinned ? '取消置顶' : '置顶'}
          onClick={() => onTogglePin(entry.id)}
        >
          {entry.pinned ? <IconCheck size={14} /> : <IconPin size={14} />}
          <span aria-hidden="true">{entry.pinned ? '已置顶' : '置顶'}</span>
        </button>
        <button
          type="button"
          className={`btn ghost ${clearArmed ? 'danger' : ''}`}
          aria-label={clearArmed ? '确认删除该条目' : '删除该条目'}
          onClick={handleDelete}
        >
          <IconTrash size={14} />
          <span aria-hidden="true">{clearArmed ? '确认删除？' : '删除'}</span>
        </button>
      </header>

      <h1 className="detail-title">{entry.title}</h1>

      <div className="detail-meta">
        <dl className="detail-grid">
          <InfoRow label="类型">
            <span className="tag neutral">{isPrompt ? 'Prompt' : '命令'}</span>
          </InfoRow>
          <InfoRow label="语言">{languageLabel(entry.langId)}</InfoRow>
          <InfoRow label="字符数">{entry.content.length}</InfoRow>
          <InfoRow label="行数">{lines}</InfoRow>
          <InfoRow label="字数">{countWords(entry.content)}</InfoRow>
          {isPrompt && (
            <InfoRow label="预估 tokens">
              约 {estimateTokens(entry.content.length)}（按字符 / 4 估算）
            </InfoRow>
          )}
          <InfoRow label="创建时间">
            {formatFullTime(entry.createdAt)}
            <span className="detail-sub">{formatRelativeTime(entry.createdAt)}</span>
          </InfoRow>
          <InfoRow label="更新时间">
            {formatFullTime(entry.updatedAt)}
            <span className="detail-sub">{formatRelativeTime(entry.updatedAt)}</span>
          </InfoRow>
          <InfoRow label="标签">
            {(entry.tags ?? []).length > 0 ? (
              <span className="detail-tags">
                {(entry.tags ?? []).map((t) => (
                  <span key={t} className="tag neutral">
                    {t}
                  </span>
                ))}
              </span>
            ) : (
              '无'
            )}
          </InfoRow>
          <InfoRow label="集合">{collection ? collection.name : '无'}</InfoRow>
          <InfoRow label="置顶">{entry.pinned ? '是' : '否'}</InfoRow>
          <InfoRow label="同步状态">
            {entry.localOnly && <IconLock size={11} />} {syncLabel(entry)}
          </InfoRow>
        </dl>
      </div>

      <section className="detail-content-wrap" aria-label="片段内容">
        <pre className="detail-content">{entry.content}</pre>
      </section>
    </div>
  )
}
