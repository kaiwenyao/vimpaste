import type { EditorMode } from '../editor/editorMode'
import { IconCloud, IconShield, IconSync } from './icons'

export interface StatusBarProps {
  editorMode: EditorMode
  vimMode: string | null
  line: number
  col: number
  langLabel: string
  chars: number
  /** prompt 类型：状态栏显示字数 + 预估 token（§8），替代语言与字符数 */
  isPrompt?: boolean
  words?: number
  tokensEstimate?: number
  /** 手动保存状态：内容非空时展示「未保存 / 已保存」；undefined = 编辑器为空，不展示 */
  saveState?: 'dirty' | 'saved'
  /** 云端同步状态（VITE_CLOUD_ENABLED 时由 App 传入；缺省 = 匿名本地版，文案不动） */
  cloudStatus?: CloudStatusView
  onCloudRetry?: () => void
}

export interface CloudStatusView {
  loggedIn: boolean
  syncing: boolean
  paused: boolean
  lastSyncLabel: string | null
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

function CloudIndicator({
  cloudStatus,
  onCloudRetry,
}: {
  cloudStatus: CloudStatusView
  onCloudRetry?: () => void
}) {
  if (!cloudStatus.loggedIn) {
    return (
      <span className="privacy">
        <IconCloud size={13} />
        <span>本地 · 未登录</span>
      </span>
    )
  }
  if (cloudStatus.paused) {
    return (
      <button
        type="button"
        className="privacy privacy-retry"
        onClick={onCloudRetry}
        aria-label="手动重试同步"
        title="同步暂停，点击重试"
      >
        <IconSync size={13} />
        <span>同步暂停 · 重试中</span>
      </button>
    )
  }
  if (cloudStatus.syncing) {
    return (
      <span className="privacy">
        <IconSync size={13} />
        <span>同步中…</span>
      </span>
    )
  }
  return (
    <span className="privacy">
      <IconCloud size={13} />
      <span>{cloudStatus.lastSyncLabel ? `已同步 · ${cloudStatus.lastSyncLabel}` : '已登录 · 待同步'}</span>
    </span>
  )
}

export function StatusBar({
  editorMode,
  vimMode,
  line,
  col,
  langLabel,
  chars,
  isPrompt,
  words,
  tokensEstimate,
  saveState,
  cloudStatus,
  onCloudRetry,
}: StatusBarProps) {
  const mode = editorMode === 'vim' ? (vimMode ?? 'NORMAL') : null
  const offMode = editorMode === 'emacs' ? 'emacs' : 'off'
  const offLabel = editorMode === 'emacs' ? 'EMACS' : '—'
  return (
    <footer className="statusbar">
      <span
        className={`mode-badge mode-${mode ? (MODE_CLASS[mode] ?? 'normal') : offMode}`}
        aria-label={`编辑器模式：${mode ?? offLabel}`}
      >
        {mode ?? offLabel}
      </span>
      <span className="status-item">
        行 {line}，列 {col}
      </span>
      {!isPrompt && <span className="status-item">{langLabel}</span>}
      {isPrompt ? (
        <>
          <span className="status-item">{words ?? 0} 字</span>
          <span className="status-item" title="按字符数 / 4 粗略估算">
            约 {tokensEstimate ?? 0} tokens（估算）
          </span>
        </>
      ) : (
        <span className="status-item">{chars} 字符</span>
      )}
      {saveState && (
        <span
          className={`save-state ${saveState === 'dirty' ? 'dirty' : 'clean'}`}
          title={saveState === 'dirty' ? '内容尚未保存，Ctrl/Cmd+S 或点「保存」入库' : '当前内容已保存到片段库'}
        >
          <span className="save-state-dot" aria-hidden="true" />
          {saveState === 'dirty' ? '未保存' : '已保存'}
        </span>
      )}
      <span className="spacer" />
      {cloudStatus ? (
        <CloudIndicator cloudStatus={cloudStatus} onCloudRetry={onCloudRetry} />
      ) : (
        <span className="privacy">
          <IconShield size={13} />
          <span>Local only · 未上传</span>
        </span>
      )}
    </footer>
  )
}
