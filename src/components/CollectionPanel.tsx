/**
 * 收藏夹面板（片段库顶部）：颜色圆点 + 条目计数 + 选中态 + 排序与编辑入口。
 *
 * 从「一排 chip、双击重命名、× 直接删除」升级为可管理的列表：每个收藏夹一眼看到
 * 颜色和条目数，写操作全部走对话框（见 CollectionDialogs），排序用 order 字段落库。
 */
import { useState } from 'react'
import type { ApiCollection, CollectionPatch } from '../cloud/api'
import {
  canMoveCollection,
  isSystemCollection,
  nextColor,
  normalizeColor,
  sortCollections,
} from '../utils/collections'
import { ColorDot, CollectionDeleteDialog, CollectionFormDialog } from './CollectionDialogs'
import { IconPencil, IconPlus } from './icons'

export interface CollectionPanelProps {
  collections: ApiCollection[]
  /** 每个收藏夹的条目数（键为收藏夹 id） */
  counts: Record<number, number>
  /** 片段库里的全部条目数（「全部收藏夹」一行用） */
  totalCount: number
  activeId: number | null
  onSelect: (id: number | null) => void
  /** 返回创建出的收藏夹（就地新建时调用方要拿它给条目重新归属） */
  onCreate: (name: string, color: string) => Promise<ApiCollection | null>
  onUpdate: (id: number, patch: CollectionPatch) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onMove: (id: number, dir: -1 | 1) => Promise<void>
}

type DialogState =
  { kind: 'create' } | { kind: 'edit'; id: number } | { kind: 'delete'; id: number }

/** 列表顺序跟随服务端（order, id）：面板不做本地乐观重排，避免和刷新后的顺序打架 */
export function CollectionPanel({
  collections,
  counts,
  totalCount,
  activeId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onMove,
}: CollectionPanelProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const ordered = sortCollections(collections)
  const editing = dialog?.kind === 'edit' ? ordered.find((c) => c.id === dialog.id) : undefined
  const deleting = dialog?.kind === 'delete' ? ordered.find((c) => c.id === dialog.id) : undefined

  return (
    <section className="collection-panel" aria-label="收藏夹">
      <div className="collection-panel-head">
        <h2 className="collection-panel-title">收藏夹</h2>
        <span className="collection-panel-count">{collections.length} 个</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost collection-new-btn"
          aria-label="新建收藏夹"
          onClick={() => setDialog({ kind: 'create' })}
        >
          <IconPlus size={13} />
          <span aria-hidden="true">新建收藏夹</span>
          <span className="en" aria-hidden="true">
            New
          </span>
        </button>
      </div>

      <ul className="collection-list">
        <li className="collection-item">
          <button
            type="button"
            className={`collection-row ${activeId === null ? 'active' : ''}`}
            aria-pressed={activeId === null}
            onClick={() => onSelect(null)}
          >
            <span className="collection-dot all" aria-hidden="true" />
            <span className="collection-row-name">全部收藏夹</span>
            <span className="collection-row-count">{totalCount}</span>
          </button>
        </li>
        {ordered.map((collection) => (
          <li
            key={collection.id}
            className={`collection-item ${activeId === collection.id ? 'active' : ''}`}
          >
            <button
              type="button"
              className={`collection-row ${activeId === collection.id ? 'active' : ''}`}
              aria-pressed={activeId === collection.id}
              onClick={() => onSelect(collection.id)}
            >
              <ColorDot color={collection.color} />
              <span className="collection-row-name">{collection.name}</span>
              {isSystemCollection(collection) && (
                <span className="collection-sys" aria-label="系统收藏夹">
                  系统
                </span>
              )}
              <span className="collection-row-count">{counts[collection.id] ?? 0}</span>
            </button>
            <button
              type="button"
              className="btn icon collection-manage"
              aria-label={`管理收藏夹「${collection.name}」`}
              onClick={() => setDialog({ kind: 'edit', id: collection.id })}
            >
              <IconPencil size={12} />
            </button>
          </li>
        ))}
      </ul>

      {dialog?.kind === 'create' && (
        <CollectionFormDialog
          collection={null}
          defaultColor={nextColor(collections)}
          onClose={() => setDialog(null)}
          onSubmit={async ({ name, color }) => {
            await onCreate(name, color)
          }}
        />
      )}

      {editing && (
        <CollectionFormDialog
          collection={editing}
          defaultColor={normalizeColor(editing.color)}
          onClose={() => setDialog(null)}
          onSubmit={async ({ name, color }) => {
            const patch: CollectionPatch = {}
            if (name !== editing.name) patch.name = name
            if (color !== normalizeColor(editing.color)) patch.color = color
            // 什么都没改就不发请求：PATCH 会推进 updatedAt，白改一次时间戳
            if (Object.keys(patch).length === 0) return
            await onUpdate(editing.id, patch)
          }}
          extras={{
            canMoveUp: canMoveCollection(ordered, editing.id, -1),
            canMoveDown: canMoveCollection(ordered, editing.id, 1),
            onMove: (dir) => onMove(editing.id, dir),
            onRequestDelete: () => setDialog({ kind: 'delete', id: editing.id }),
          }}
        />
      )}

      {deleting && (
        <CollectionDeleteDialog
          collection={deleting}
          count={counts[deleting.id] ?? 0}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await onDelete(deleting.id)
          }}
        />
      )}
    </section>
  )
}
