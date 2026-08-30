import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** 克制、工具质感的深色主题：编辑器本体 + 深色语法配色 + 占位符标记 */
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
  '.cm-activeLine': { backgroundColor: 'rgba(122, 162, 247, 0.07)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(122, 162, 247, 0.12)', color: 'var(--text)' },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(122, 162, 247, 0.28) !important',
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
  '.cm-searchMatch': { backgroundColor: 'rgba(224, 175, 104, 0.28)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(224, 175, 104, 0.55)' },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(143, 177, 255, 0.18)',
    outline: '1px solid rgba(143, 177, 255, 0.45)',
  },
  '.cm-nonmatchingBracket': { outline: '1px solid rgba(247, 118, 142, 0.45)' },
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
  { tag: t.keyword, color: '#7aa2f7' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#bb9af7' },
  { tag: [t.string, t.special(t.string)], color: '#9ece6a' },
  { tag: [t.number, t.bool, t.atom], color: '#ff9e64' },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: '#5f6b85',
    fontStyle: 'italic',
  },
  { tag: [t.variableName, t.propertyName], color: '#d7dee7' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7dcfff' },
  { tag: [t.operator, t.operatorKeyword, t.punctuation], color: '#89ddff' },
  { tag: [t.definition(t.variableName)], color: '#e0af68' },
  { tag: [t.tagName, t.standard(t.tagName)], color: '#bb9af7' },
  { tag: t.attributeName, color: '#73daca' },
  { tag: [t.meta, t.processingInstruction], color: '#a9b1d6' },
  { tag: t.link, color: '#7dcfff', textDecoration: 'underline' },
  { tag: t.heading, color: '#e0af68', fontWeight: 'bold' },
  { tag: t.invalid, color: '#f7768e' },
])

export const vimpasteSyntax = syntaxHighlighting(vimpasteHighlightStyle)
