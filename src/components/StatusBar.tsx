export interface StatusBarProps {
  vimEnabled: boolean
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

export function StatusBar({ vimEnabled, vimMode, line, col, langLabel, chars }: StatusBarProps) {
  const mode = !vimEnabled ? null : (vimMode ?? 'NORMAL')
  return (
    <footer className="statusbar">
      <span
        className={`mode-badge mode-${mode ? (MODE_CLASS[mode] ?? 'normal') : 'off'}`}
        aria-label={`Vim 模式：${mode ?? '关闭'}`}
      >
        {mode ?? '—'}
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
