/**
 * 行内「移动到收藏夹」入口：一个浮层选择器。
 *
 * 之前只有把条目在编辑器里打开、露出「编辑中」条目栏时才改得动收藏夹归属，
 * 片段库里完全看不出某条属于谁、也搬不动它。这里给每一行配一个入口，
 * 并且当前归属用勾选态标出来。
 *
 * 浮层用 position: fixed 由触发按钮的矩形定位：列表容器是 overflow: auto 的滚动区，
 * 绝对定位的浮层会被裁掉；fixed 定位不受祖先 overflow 裁剪（祖先没有 transform）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApiCollection } from '../cloud/api'
import { sortCollections } from '../utils/collections'
import { ColorDot } from './CollectionDialogs'
import { IconCheck, IconFolder } from './icons'

export interface CollectionMoveMenuProps {
  entryTitle: string
  currentId: number | null
  collections: ApiCollection[]
  counts: Record<number, number>
  onPick: (collectionId: number | null) => void
  /** 「新建收藏夹…」：由调用方打开新建对话框，创建成功后把条目移进去 */
  onCreateRequest: () => void
}

const MENU_WIDTH = 224

export function CollectionMoveMenu({
  entryTitle,
  currentId,
  collections,
  counts,
  onPick,
  onCreateRequest,
}: CollectionMoveMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const rect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const width = menuRect.width || MENU_WIDTH
    const height = menuRect.height
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    )
    const below = rect.bottom + 6
    // 贴近视口底部时向上翻，浮层不会被窗口切掉
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below
    setPos({ top, left })
  }, [open, collections.length])

  // 打开时把焦点送进浮层；滚动/缩放/点击外部即收起（位置依赖触发按钮的矩形）
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector('button')?.focus()
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const pick = (collectionId: number | null) => {
    onPick(collectionId)
    close(true)
  }

  const ordered = sortCollections(collections)

  return (
    <span className="move-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="btn icon history-item-move"
        aria-label={`移动「${entryTitle}」到收藏夹`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconFolder size={13} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="move-menu"
          role="group"
          aria-label="移动到收藏夹"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close(true)
            }
          }}
        >
          <button
            type="button"
            className={`move-menu-item ${currentId === null ? 'on' : ''}`}
            aria-current={currentId === null}
            onClick={() => pick(null)}
          >
            <span className="move-menu-mark" aria-hidden="true">
              <span className="move-menu-none" />
            </span>
            <span className="move-menu-name">未分类</span>
            {currentId === null && (
              <span className="move-menu-check" aria-hidden="true">
                <IconCheck size={11} />
              </span>
            )}
          </button>
          {ordered.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={`move-menu-item ${currentId === collection.id ? 'on' : ''}`}
              aria-current={currentId === collection.id}
              onClick={() => pick(collection.id)}
            >
              <span className="move-menu-mark" aria-hidden="true">
                <ColorDot color={collection.color} size={9} />
              </span>
              <span className="move-menu-name">{collection.name}</span>
              {currentId === collection.id && (
                <span className="move-menu-check" aria-hidden="true">
                  <IconCheck size={11} />
                </span>
              )}
              <span className="move-menu-count">{counts[collection.id] ?? 0}</span>
            </button>
          ))}
          <span className="move-menu-sep" aria-hidden="true" />
          <button
            type="button"
            className="move-menu-item move-menu-new"
            onClick={() => {
              onCreateRequest()
              close(true)
            }}
          >
            <span className="move-menu-mark" aria-hidden="true">
              ＋
            </span>
            新建收藏夹…
          </button>
        </div>
      )}
    </span>
  )
}
