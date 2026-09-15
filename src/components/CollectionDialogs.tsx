/**
 * 收藏夹的对话框：新建 / 编辑（名称 + 颜色 + 排序 + 删除入口）与删除二次确认。
 *
 * 之前收藏夹的重命名靠双击 chip、删除靠一个没有确认的 ×，两个动作都不可发现且危险。
 * 这里把所有写操作收进对话框：名称与颜色是显式表单（Enter 提交 / Esc 取消），
 * 删除永远先看到「N 条片段会变为未分类」再确认。
 */
import { useId, useState } from 'react'
import type { ApiCollection } from '../cloud/api'
import { COLLECTION_COLORS, isSystemCollection, normalizeColor } from '../utils/collections'
import { Dialog } from './Dialog'
import { IconArrowDown, IconArrowUp, IconTrash } from './icons'

/** 收藏夹颜色圆点：色值来自用户数据（#RRGGBB），不能用主题令牌（换主题会变色） */
export function ColorDot({
  color,
  size = 10,
  className = '',
}: {
  color: string | null | undefined
  size?: number
  className?: string
}) {
  return (
    <span
      className={`collection-dot ${className}`}
      style={{ background: normalizeColor(color), width: size, height: size }}
      aria-hidden="true"
    />
  )
}

/** 编辑既有收藏夹时的附加操作：排序与删除（新建时不传） */
export interface CollectionFormExtras {
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (dir: -1 | 1) => Promise<void>
  onRequestDelete: () => void
}

export interface CollectionFormDialogProps {
  /** null = 新建；否则编辑该收藏夹。
   *  调用方按需挂载本组件（不传 open）："打开" 就等于重新挂载，
   *  表单初值直接用 useState 的初始值，不必用 effect 回灌上一次的输入。 */
  collection: ApiCollection | null
  /** 新建时的初始颜色（由调用方按「还没被占用的色」挑选） */
  defaultColor: string
  onClose: () => void
  /** 失败时抛错：错误文案就地展示在对话框里，关掉对话框就等于放弃这次修改 */
  onSubmit: (values: { name: string; color: string }) => Promise<void>
  extras?: CollectionFormExtras
}

export function CollectionFormDialog({
  collection,
  defaultColor,
  onClose,
  onSubmit,
  extras,
}: CollectionFormDialogProps) {
  const editing = collection !== null
  const system = collection !== null && isSystemCollection(collection)
  const nameId = useId()
  const colorId = useId()
  const [name, setName] = useState(collection?.name ?? '')
  const [color, setColor] = useState(normalizeColor(collection?.color ?? defaultColor))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('收藏夹名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: trimmed, color })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请稍后重试')
      setBusy(false)
    }
  }

  const runExtra = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? `编辑收藏夹「${collection.name}」` : '新建收藏夹'}
    >
      <form
        className="collection-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="collection-field" htmlFor={nameId}>
          <span className="collection-field-label">名称</span>
          <input
            id={nameId}
            className="collection-field-input"
            type="text"
            value={name}
            maxLength={64}
            autoFocus
            disabled={system || busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {system && (
          <p className="collection-hint">
            default 是系统收藏夹（新片段的默认落点），不能重命名或删除；颜色与排序可以改。
          </p>
        )}

        <fieldset className="collection-field collection-field-colors">
          <legend className="collection-field-label" id={colorId}>
            颜色
          </legend>
          <div className="collection-swatches" role="radiogroup" aria-labelledby={colorId}>
            {COLLECTION_COLORS.map((option) => (
              <label
                key={option.hex}
                className={`collection-swatch ${color === option.hex ? 'on' : ''}`}
                title={option.label}
              >
                <input
                  type="radio"
                  name={`collection-color-${nameId}`}
                  value={option.hex}
                  aria-label={option.label}
                  checked={color === option.hex}
                  disabled={busy}
                  onChange={() => setColor(option.hex)}
                />
                <ColorDot color={option.hex} size={16} />
              </label>
            ))}
          </div>
        </fieldset>

        {error !== null && (
          <p className="collection-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {editing ? '保存' : '创建'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>

        {extras && (
          <div className="collection-extras">
            <button
              type="button"
              className="btn ghost"
              aria-label={`上移收藏夹「${collection?.name ?? ''}」`}
              disabled={busy || !extras.canMoveUp}
              onClick={() => void runExtra(() => extras.onMove(-1))}
            >
              <IconArrowUp size={13} />
              <span aria-hidden="true">上移</span>
            </button>
            <button
              type="button"
              className="btn ghost"
              aria-label={`下移收藏夹「${collection?.name ?? ''}」`}
              disabled={busy || !extras.canMoveDown}
              onClick={() => void runExtra(() => extras.onMove(1))}
            >
              <IconArrowDown size={13} />
              <span aria-hidden="true">下移</span>
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn ghost danger"
              aria-label="删除收藏夹"
              disabled={busy || system}
              onClick={() => extras.onRequestDelete()}
            >
              <IconTrash size={13} />
              <span aria-hidden="true">删除收藏夹</span>
            </button>
          </div>
        )}
      </form>
    </Dialog>
  )
}

export interface CollectionDeleteDialogProps {
  /** 调用方按需挂载（同 CollectionFormDialog，不传 open） */
  collection: ApiCollection | null
  /** 该收藏夹里的片段数：确认文案要说清会影响到多少条 */
  count: number
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function CollectionDeleteDialog({
  collection,
  count,
  onClose,
  onConfirm,
}: CollectionDeleteDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，请稍后重试')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`删除收藏夹「${collection?.name ?? ''}」`}>
      <p className="confirm-text">
        {count > 0
          ? `其中的 ${count} 条片段会变为未分类，片段本身不会被删除。`
          : '这个收藏夹里还没有片段。'}
      </p>
      {error !== null && (
        <p className="collection-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="btn ghost danger"
          disabled={busy}
          onClick={() => void confirm()}
        >
          确认删除
        </button>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
      </div>
    </Dialog>
  )
}
