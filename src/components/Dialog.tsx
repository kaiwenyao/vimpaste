import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { IconClose } from './icons'

/**
 * 通用对话框：Esc 关闭、打开时聚焦、点击遮罩关闭。
 *
 * 一律 portal 到 <body>：遮罩是 `position: fixed; inset: 0`，若原地渲染在页面容器里，
 * 会被内容列布局（如 `.page > *` 的 880px 限宽 + 居中）和带 transform/overflow 的祖先
 * 约束，变成只盖住中间一列的暗条。挂到 body 后遮罩天然铺满视口，也不受调用位置影响。
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel = '关闭',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <button
            type="button"
            className="btn ghost icon dialog-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <IconClose size={13} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
