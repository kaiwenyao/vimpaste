import { useEffect, useState } from 'react'
import type { Snippet } from '../storage/snippets'
import type { ApiCollection } from '../cloud/api'
import { IconCheck, IconCopy, IconLock, IconPin } from './icons'

/**
 * 条目元信息条（plan-v2-accounts.md §5/§7.4/§8）：
 * 当前编辑条目的置顶、仅本地开关、标签与集合编辑。
 * 「仅本地」做在显眼位置——用户会往里存真实密钥（§10 风险 2）。
 */
export function EntryMetaBar({
  entry,
  collections,
  onTogglePin,
  onToggleLocalOnly,
  onTagsChange,
  onCollectionChange,
}: {
  entry: Snippet
  collections: ApiCollection[]
  onTogglePin: (id: string) => void
  onToggleLocalOnly: (id: string) => void
  onTagsChange: (id: string, tags: string[]) => void
  onCollectionChange: (id: string, collectionId: number | null) => void
}) {
  const [tagsDraft, setTagsDraft] = useState<string | null>(null)
  const tagsValue = tagsDraft ?? (entry.tags ?? []).join(', ')

  // 切换条目时放弃未提交的草稿（渲染期重置，等价于对 entry.id 的派生状态）
  const [draftEntryId, setDraftEntryId] = useState(entry.id)
  if (draftEntryId !== entry.id) {
    setDraftEntryId(entry.id)
    setTagsDraft(null)
  }

  const commitTags = () => {
    if (tagsDraft === null) return
    setTagsDraft(null)
    const tags = tagsDraft
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter((t) => t !== '')
    const before = (entry.tags ?? []).join('|')
    if (tags.join('|') !== before) onTagsChange(entry.id, tags)
  }

  return (
    <div className="entry-meta" aria-label="条目属性">
      <button
        type="button"
        className={`btn ghost icon ${entry.pinned ? 'sage' : ''}`}
        aria-label={entry.pinned ? '取消置顶' : '置顶'}
        title={entry.pinned ? '取消置顶' : '置顶'}
        onClick={() => onTogglePin(entry.id)}
      >
        <IconPin size={13} />
      </button>

      <label className="switch small" title="仅本地的条目永不离开浏览器，换设备不可见">
        <input
          type="checkbox"
          role="switch"
          checked={entry.localOnly === true}
          onChange={() => onToggleLocalOnly(entry.id)}
        />
        <span>
          <IconLock size={10} /> 仅本地
        </span>
      </label>

      <input
        type="text"
        className="entry-tags"
        aria-label="标签（逗号分隔）"
        placeholder="标签，逗号分隔"
        value={tagsValue}
        onChange={(e) => setTagsDraft(e.target.value)}
        onBlur={commitTags}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitTags()
        }}
      />

      {collections.length > 0 && (
        <select
          className="select small"
          aria-label="所属集合"
          value={entry.collectionId ?? ''}
          onChange={(e) =>
            onCollectionChange(entry.id, e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">无集合</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/**
 * 变量填充表单（§8 Phase 6）：每个 {{变量}} 一个输入框，
 * 「填充并复制」得到可直接粘给 LLM 的成品——原文不被修改。
 * 记住每个变量上次填的值（仅本地）。
 */
export function VariableFillBar({
  names,
  values,
  onChange,
  onFillAndCopy,
}: {
  names: string[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  onFillAndCopy: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const allFilled = names.every((n) => (values[n] ?? '').trim() !== '')

  return (
    <div className="varfill" aria-label="变量填充">
      <span className="varfill-title">填充变量</span>
      {names.map((name) => (
        <label key={name} className="varfill-field">
          <span className="varfill-name">{name}</span>
          <input
            type="text"
            aria-label={`变量 ${name} 的值`}
            placeholder={`填写 ${name}`}
            value={values[name] ?? ''}
            onChange={(e) => onChange(name, e.target.value)}
          />
        </label>
      ))}
      <button
        type="button"
        className={`btn ${allFilled && !copied ? 'primary' : 'ghost'} ${copied ? 'sage' : ''}`}
        disabled={!allFilled}
        aria-label="填充并复制"
        title={allFilled ? '替换 {{变量}} 后复制（原文不变）' : '填写全部变量后可用'}
        onClick={() => {
          onFillAndCopy()
          setCopied(true)
        }}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        <span aria-hidden="true">{copied ? '已复制' : '填充并复制'}</span>
      </button>
    </div>
  )
}
