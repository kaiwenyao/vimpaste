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
  /** 保存去向：new=编辑器里是新片段；existing=正在编辑已有条目（与工具栏保存按钮文案同源） */
  saveTarget?: 'new' | 'existing'
  /** 正在编辑的条目标题：只用于状态栏的「编辑「<标题>」」提示 */
  saveTargetTitle?: string | null
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
      <span>
        {cloudStatus.lastSyncLabel ? `已同步 · ${cloudStatus.lastSyncLabel}` : '已登录 · 待同步'}
      </span>
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
  saveTarget,
  saveTargetTitle,
  cloudStatus,
  onCloudRetry,
}: StatusBarProps) {
  const mode = editorMode === 'vim' ? (vimMode ?? 'NORMAL') : null
  const offMode = editorMode === 'emacs' ? 'emacs' : 'off'
  const offLabel = editorMode === 'emacs' ? 'EMACS' : '—'
  // 状态栏与工具栏按钮说同一件事：这次保存是「新建一条」还是「更新这条」
  const editingExisting = saveTarget === 'existing'
  const targetName = saveTargetTitle?.trim() ? `「${saveTargetTitle.trim()}」` : ''
  const saveAction = editingExisting ? `保存修改${targetName}` : '保存为新片段'
  const saveHint = editingExisting
    ? `当前编辑器对应已有片段${targetName || ''}；「保存修改」或 Ctrl/Cmd+S 会把内容写回它`
    : '当前内容还没有对应片段；「保存为新片段」或 Ctrl/Cmd+S 会新建一条'
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
          title={
            saveState === 'dirty'
              ? `内容尚未保存，Ctrl/Cmd+S 或点「${saveAction}」入库`
              : `当前内容已保存到片段库（${saveAction}）`
          }
        >
          <span className="save-state-dot" aria-hidden="true" />
          {saveState === 'dirty' ? '未保存' : '已保存'}
        </span>
      )}
      {/* 编辑器当前对应哪条片段：只在编辑已有条目时出现
          （「新片段」身份已由工具栏胶囊与编辑器上方的条目栏说明） */}
      {saveState && editingExisting && (
        <span className="status-item save-target-hint" title={saveHint}>
          编辑{targetName || '当前片段'}
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
