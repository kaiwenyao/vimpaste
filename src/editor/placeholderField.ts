import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { findPlaceholders, type PlaceholderMatch } from '../detection/placeholders'

/**
 * 占位符装饰：识别结果只做视觉标记与导航，不修改文本。
 * 放在 StateField 中，导航（]v / [v / 按钮）与计数都从这里读取。
 */

export interface PlaceholderState {
  set: ReturnType<typeof Decoration.set>
  ranges: PlaceholderMatch[]
}

export const placeholderField = StateField.define<PlaceholderState>({
  create: () => ({ set: Decoration.none, ranges: [] }),
  update(value, tr) {
    if (!tr.docChanged) return value
    const ranges = findPlaceholders(tr.state.doc.toString())
    if (ranges.length === 0 && value.ranges.length === 0) return value
    const set = Decoration.set(
      ranges.map((r) => Decoration.mark({ class: 'cm-vp-placeholder' }).range(r.start, r.end)),
      true,
    )
    return { set, ranges }
  },
})

export function placeholderRanges(state: EditorState): PlaceholderMatch[] {
  return state.field(placeholderField, false)?.ranges ?? []
}

export const placeholderHighlight = EditorView.decorations.compute(
  [placeholderField],
  (state) => state.field(placeholderField, false)?.set ?? Decoration.none,
)
