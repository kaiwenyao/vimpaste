import { StreamLanguage } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Markdown 轻高亮（plan-v2-accounts.md §8）：只覆盖 Prompt 散文最需要的形态——
 * 标题、列表、引用、行内代码、加粗、链接与 ``` 代码围栏。
 * 不引入完整 markdown 语言包（体积与首屏预算），够辨识即可。
 */

interface MdLiteState {
  inCodeFence: boolean
}

export const markdownLite = StreamLanguage.define<MdLiteState>({
  name: 'markdown-lite',
  startState(): MdLiteState {
    return { inCodeFence: false }
  },
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^```/)) {
        state.inCodeFence = !state.inCodeFence
        return 'monospace'
      }
      if (stream.match(/^#{1,6}\s.*$/)) return 'heading'
      if (stream.match(/^\s*(?:[-*+]|\d+[.)])\s/)) return 'meta'
      if (stream.match(/^>\s?.*$/)) return 'quote'
    }
    if (state.inCodeFence) {
      stream.skipToEnd()
      return 'monospace'
    }
    if (stream.match(/`[^`\n]+`/)) return 'monospace'
    if (stream.match(/\*\*[^*\n]+\*\*/)) return 'strong'
    if (stream.match(/\[[^\]\n]+\]\([^)\n]+\)/)) return 'link'
    stream.next()
    return null
  },
  // 自定义 token 名 → 高亮 tag；heading/link/meta 在 vimpasteHighlightStyle 里有配色
  tokenTable: {
    heading: t.heading,
    strong: t.strong,
    monospace: t.monospace,
    link: t.link,
    quote: t.quote,
    meta: t.meta,
  },
})
