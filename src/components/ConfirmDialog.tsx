import type { ReactNode } from 'react'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  /** 对话框标题，同时作为 role="dialog" 的可访问名称 */
  title: string
  /** 说明这次确认会造成什么（用 .confirm-text 排版） */
  message: ReactNode
  /** 确认按钮文案：默认「确认删除」 */
  confirmLabel?: string
  /** 取消按钮文案：默认「取消」 */
  cancelLabel?: string
  /** 确认按钮的无障碍名称（按钮上可能只写短文案，这里补全上下文） */
  confirmAriaLabel?: string
  onConfirm: () => void
  onClose: () => void
}

/**
 * 通用二次确认对话框：危险操作用它替代「再点一次」的两段式按钮。
 * Esc / 点遮罩 / 取消都只关闭对话框，绝不会触发 onConfirm。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  confirmAriaLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open onClose={onClose} title={title}>
      <p className="confirm-text">{message}</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn ghost danger"
          aria-label={confirmAriaLabel}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {cancelLabel}
        </button>
      </div>
    </Dialog>
  )
}
