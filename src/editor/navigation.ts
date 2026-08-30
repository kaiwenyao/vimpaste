import { EditorView } from '@codemirror/view'
import { placeholderRanges } from './placeholderField'
import type { PlaceholderMatch } from '../detection/placeholders'

/**
 * 占位符导航：跳到下一个/上一个占位符并选中其文本，方便立即替换。
 * `]v` / `[v` 与工具栏按钮共用同一实现；允许误判，绝不阻止编辑与复制。
 */
export function jumpToPlaceholder(view: EditorView, dir: 1 | -1): boolean {
  const ranges = placeholderRanges(view.state)
  if (ranges.length === 0) return false
  const pos = view.state.selection.main.head
  let target: PlaceholderMatch | undefined
  if (dir > 0) {
    target = ranges.find((r) => r.start > pos) ?? ranges[0]
  } else {
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (ranges[i].end < pos) {
        target = ranges[i]
        break
      }
    }
    target ??= ranges[ranges.length - 1]
  }
  view.dispatch({
    selection: { anchor: target.start, head: target.end },
    effects: EditorView.scrollIntoView(target.start, { y: 'center' }),
  })
  view.focus()
  return true
}
