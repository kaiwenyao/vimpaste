import type { EditorMode } from '../editor/editorMode'

export interface StatusBarProps {
  editorMode: EditorMode
  vimMode: string | null
  line: number
  col: number
  langLabel: string
  chars: number
}

const MODE_CLASS: Record<string, string> = {
  NORMAL: 'normal',
  INSERT: 'insert',
  VISUAL: 'visual',
  'V-LINE': 'visual',
  'V-BLOCK': 'visual',
  COMMAND: 'command',
  REPLACE: 'replace',
}

export function StatusBar({ editorMode, vimMode, line, col, langLabel, chars }: StatusBarProps) {
  const mode = editorMode === 'vim' ? (vimMode ?? 'NORMAL') : null
  const offLabel = editorMode === 'emacs' ? 'EMACS' : '—'
  return (
    <footer className="statusbar">
      <span
        className={`mode-badge mode-${mode ? (MODE_CLASS[mode] ?? 'normal') : 'off'}`}
        aria-label={`编辑器模式：${mode ?? offLabel}`}
      >
        {mode ?? offLabel}
      </span>
      <span className="status-item">
        行 {line}，列 {col}
      </span>
      <span className="status-item">{langLabel}</span>
      <span className="status-item">{chars} 字符</span>
      <span className="spacer" />
      <span className="privacy">Local only · 未上传</span>
    </footer>
  )
}
