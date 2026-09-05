import { StateField, Facet } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { findPlaceholders, findPromptPlaceholders } from '../detection/placeholders'
import type { SnippetKind } from '../storage/snippets'

/**
 * 占位符装饰：识别结果只做视觉标记与导航，不修改文本。
 * 放在 StateField 中，导航（]v / [v / 按钮）与计数都从这里读取。
 *
 * 编辑器「类型」（command / prompt）通过 editorKindFacet 切换：
 * command 走现有识别规则（YOUR_TOKEN / ${VAR} / <IP> / 环境变量赋值），
 * prompt 走 {{变量}} / [待填写] / 【主题】规则（plan-v2-accounts.md §8）。
 */

export const editorKindFacet = Facet.define<SnippetKind, SnippetKind>({
  combine: (values) => values[values.length - 1] ?? 'command',
})

/** 导航与计数只需要位置与文本：两种识别规则（command/prompt）统一成最小结构 */
export interface AnyPlaceholderMatch {
  start: number
  end: number
  text: string
}

export interface PlaceholderState {
  set: ReturnType<typeof Decoration.set>
  ranges: AnyPlaceholderMatch[]
}

function computePlaceholders(state: EditorState): PlaceholderState {
  const text = state.doc.toString()
  const ranges =
    state.facet(editorKindFacet) === 'prompt'
      ? findPromptPlaceholders(text)
      : findPlaceholders(text)
  if (ranges.length === 0) return { set: Decoration.none, ranges }
  const set = Decoration.set(
    ranges.map((r) => Decoration.mark({ class: 'cm-vp-placeholder' }).range(r.start, r.end)),
    true,
  )
  return { set, ranges }
}

export const placeholderField = StateField.define<PlaceholderState>({
  create: computePlaceholders,
  update(value, tr) {
    const kindChanged = tr.state.facet(editorKindFacet) !== tr.startState.facet(editorKindFacet)
    if (!tr.docChanged && !kindChanged) return value
    return computePlaceholders(tr.state)
  },
})

export function placeholderRanges(state: EditorState): AnyPlaceholderMatch[] {
  return state.field(placeholderField, false)?.ranges ?? []
}

export const placeholderHighlight = EditorView.decorations.compute(
  [placeholderField],
  (state) => state.field(placeholderField, false)?.set ?? Decoration.none,
)
