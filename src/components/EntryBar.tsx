import { useEffect, useState } from 'react'
import type { Snippet } from '../storage/snippets'
import { SNIPPET_NOTE_MAX_CHARS, SNIPPET_TITLE_MAX_CHARS } from '../storage/snippets'
import type { ApiCollection } from '../cloud/api'
import { IconCheck, IconCopy, IconLock, IconPin } from './icons'

/**
 * 条目元信息条（plan-v2-accounts.md §5/§7.4/§8）：
 * 当前编辑条目的 标题/备注、置顶、仅本地开关、标签与收藏夹编辑。
 * 开头的「编辑中」徽标 + 保存状态文案向用户明示：编辑器里是已有片段（不是新片段），
 * 以及这份内容是否已经入库——与工具栏「保存修改」按钮一一对应。
 * 「仅本地」做在显眼位置——用户会往里存真实密钥（§10 风险 2）。
 */
export function EntryMetaBar({
  entry,
  dirty,
  collections,
  onTogglePin,
  onToggleLocalOnly,
  onTagsChange,
  onCollectionChange,
  onTitleChange,
  onNoteChange,
}: {
  entry: Snippet
  /** 编辑器内容与这条已保存片段不一致（未保存修改）时置真 */
  dirty?: boolean
  collections: ApiCollection[]
  onTogglePin: (id: string) => void
  onToggleLocalOnly: (id: string) => void
  onTagsChange: (id: string, tags: string[]) => void
  onCollectionChange: (id: string, collectionId: number | null) => void
  onTitleChange: (id: string, title: string) => void
  onNoteChange: (id: string, note: string) => void
}) {
  const [tagsDraft, setTagsDraft] = useState<string | null>(null)
  const tagsValue = tagsDraft ?? (entry.tags ?? []).join(', ')
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const titleValue = titleDraft ?? entry.title
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const noteValue = noteDraft ?? entry.note ?? ''

  // 切换条目时放弃未提交的草稿（渲染期重置，等价于对 entry.id 的派生状态）
  const [draftEntryId, setDraftEntryId] = useState(entry.id)
  if (draftEntryId !== entry.id) {
    setDraftEntryId(entry.id)
    setTagsDraft(null)
    setTitleDraft(null)
    setNoteDraft(null)
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

  const commitTitle = () => {
    if (titleDraft === null) return
    setTitleDraft(null)
    if (titleDraft.trim() !== entry.title) onTitleChange(entry.id, titleDraft)
  }

  const commitNote = () => {
    if (noteDraft === null) return
    setNoteDraft(null)
    if (noteDraft.trim() !== (entry.note ?? '')) onNoteChange(entry.id, noteDraft)
  }

  return (
    <div className="entry-meta" aria-label="条目属性">
      <span className="meta-badge edit" aria-hidden="true">
        编辑中
      </span>
      {/* 与工具栏「保存修改」同源的说明：这条片段叫什么、改动是否还在编辑器里 */}
      <span className="meta-state" title={`正在编辑的片段：「${entry.title}」`}>
        {dirty ? '有未保存的修改 · 点「保存修改」写回本条' : '内容已保存 · 改完点「保存修改」'}
      </span>

      <input
        type="text"
        className="entry-title"
        aria-label="片段标题"
        placeholder="标题，留空自动取首行"
        maxLength={SNIPPET_TITLE_MAX_CHARS}
        value={titleValue}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitTitle()
        }}
      />

      <input
        type="text"
        className="entry-note"
        aria-label="片段备注"
        placeholder="备注：这个片段是做什么的（可选）"
        maxLength={SNIPPET_NOTE_MAX_CHARS}
        value={noteValue}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={commitNote}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitNote()
        }}
      />

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
          aria-label="所属收藏夹"
          value={entry.collectionId ?? ''}
          onChange={(e) =>
            onCollectionChange(entry.id, e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">无收藏夹</option>
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
 * 新片段栏：编辑器里有内容但尚未关联任何已保存条目时显示，
 * 与「编辑中」条目栏形成明确对照——这里的一切都还没有入库。
 * 标题/备注作为草稿，随下一次「保存」一起写入片段库；
 * 保存目标收藏夹也在这里选定，默认落在 default 收藏夹（云端模式）。
 */
export function NewSnippetBar({
  title,
  note,
  collections = [],
  collectionId,
  onCollectionChange,
  onTitleChange,
  onNoteChange,
}: {
  title: string
  note: string
  /** 云端模式下传入；匿名构建恒为空、不显示收藏夹选择 */
  collections?: ApiCollection[]
  collectionId: number | null
  onCollectionChange: (collectionId: number | null) => void
  onTitleChange: (title: string) => void
  onNoteChange: (note: string) => void
}) {
  return (
    <div className="entry-meta new-snippet" aria-label="新片段，尚未保存">
      <span className="meta-badge new" aria-hidden="true">
        新片段
      </span>
      <span className="meta-state">尚未保存 · 点「保存为新片段」进入片段库</span>

      <input
        type="text"
        className="entry-title"
        aria-label="新片段标题"
        placeholder="标题，留空自动取首行"
        maxLength={SNIPPET_TITLE_MAX_CHARS}
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
      />

      <input
        type="text"
        className="entry-note"
        aria-label="新片段备注"
        placeholder="备注：这个片段是做什么的（可选）"
        maxLength={SNIPPET_NOTE_MAX_CHARS}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
      />

      {collections.length > 0 && (
        <select
          className="select small"
          aria-label="保存到收藏夹"
          value={collectionId ?? ''}
          onChange={(e) =>
            onCollectionChange(e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">无收藏夹</option>
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
