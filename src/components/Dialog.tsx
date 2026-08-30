import { useEffect } from 'react'
import type { ReactNode } from 'react'

/** 通用对话框：Esc 关闭、打开时聚焦、点击遮罩关闭 */
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
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <button type="button" className="btn ghost" aria-label={closeLabel} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}
