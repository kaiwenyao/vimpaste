import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * 编辑器主题：所有颜色都通过 CSS 变量引用，
 * 由 global.css 中 html[data-theme] 的主题块提供，切换主题无需重建编辑器。
 */
export const vimpasteTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13.5px',
    backgroundColor: 'var(--bg-editor)',
    color: 'var(--text)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    caretColor: 'var(--accent)',
    paddingBottom: '40vh',
  },
  '.cm-line': { padding: '0 8px' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.65' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-editor)',
    color: 'var(--muted-2)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line-gutter)', color: 'var(--text)' },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--sel) !important',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '.cm-vp-placeholder': {
    backgroundColor: 'var(--ph-bg)',
    borderBottom: '1px dashed var(--ph-border)',
    borderRadius: '2px',
    padding: '1px 0',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
  },
  '.cm-panels input, .cm-panels button, .cm-panels select': {
    background: 'var(--bg-control)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-panels label': { color: 'var(--muted)' },
  '.cm-panel.cm-search .cm-textfield': { minWidth: '14em' },
  '.cm-panel button[name=close]': { color: 'var(--muted)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-active)' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--bracket-bg)',
    outline: '1px solid var(--bracket-border)',
  },
  '.cm-nonmatchingBracket': { outline: '1px solid var(--danger)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-control)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
  },
})

export const vimpasteHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: 'var(--syn-control)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--syn-number)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--syn-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.variableName, t.propertyName], color: 'var(--syn-variable)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--syn-func)',
  },
  { tag: [t.operator, t.operatorKeyword, t.punctuation], color: 'var(--syn-operator)' },
  { tag: [t.definition(t.variableName)], color: 'var(--syn-def)' },
  { tag: [t.tagName, t.standard(t.tagName)], color: 'var(--syn-tag)' },
  { tag: t.attributeName, color: 'var(--syn-attr)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--syn-meta)' },
  { tag: t.link, color: 'var(--syn-link)', textDecoration: 'underline' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: 'bold' },
  { tag: t.invalid, color: 'var(--syn-invalid)' },
])

export const vimpasteSyntax = syntaxHighlighting(vimpasteHighlightStyle)
