import { useEffect, useRef } from 'react'
import { LANGUAGES } from '../detection/language'
import type { LangId } from '../detection/language'
import { THEMES } from '../theme/themes'
import type { ThemeId } from '../theme/themes'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconHelp,
  IconHistory,
  IconSettings,
  IconUser,
} from './icons'

export interface ToolbarProps {
  langId: LangId
  langAuto: boolean
  manualOverride: boolean
  onLanguageChange: (id: LangId) => void
  /** prompt 类型：语言识别关闭，下拉只留 纯文本/Markdown（§8） */
  promptMode?: boolean
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
  onOpenSettings: () => void
  onToggleHistory: () => void
  historyOpen: boolean
  placeholderCount: number
  onPrevPlaceholder: () => void
  onNextPlaceholder: () => void
  canCopy: boolean
  /** 复制成功后的短暂状态：按钮就地变为「已复制」，与编辑器描边、确认条同进同出 */
  copied: boolean
  onCopy: () => void
  clearArmed: boolean
  onClear: () => void
  onHelp: () => void
  /** 云构建（VITE_CLOUD_ENABLED）才有账号入口；匿名本地版不渲染 */
  cloudEnabled?: boolean
  accountLabel?: string | null
  onOpenAccount?: () => void
}

/**
 * 工具栏按「身份 → 内容属性 → 待办 → 动作」排序（设计稿 1a）：
 * 品牌、历史、语言在左，中间是待替换计数与前后跳转，右侧只留帮助/设置/主题/清空/复制。
 * 英文副标与快捷键提示都是 aria-hidden 的装饰，可访问名称仍是稳定的中文标签。
 */
export function Toolbar(props: ToolbarProps) {
  const {
    langId,
    langAuto,
    manualOverride,
    onLanguageChange,
    promptMode,
    theme,
    onThemeChange,
    onOpenSettings,
    onToggleHistory,
    historyOpen,
    placeholderCount,
    onPrevPlaceholder,
    onNextPlaceholder,
    canCopy,
    copied,
    onCopy,
    clearArmed,
    onClear,
    onHelp,
    cloudEnabled,
    accountLabel,
    onOpenAccount,
  } = props

  const armedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (clearArmed) armedRef.current?.focus()
  }, [clearArmed])

  // 三态：空编辑器（中性）→ 有占位符待替换（主色）→ 有内容且已全部替换（鼠尾草绿）
  const allReplaced = canCopy && placeholderCount === 0
  const phState = !canCopy ? 'idle' : allReplaced ? 'done' : 'pending'

  return (
    <header className="toolbar">
      <span className="brand" aria-label="VimPaste">
        <span className="brand-mark" aria-hidden="true">
          &gt;
          <span className="brand-cursor">_</span>
        </span>
        <span className="brand-name">VimPaste</span>
      </span>

      <button
        type="button"
        className="btn"
        aria-label="历史记录"
        title="粘贴历史（保存在本浏览器）"
        aria-expanded={historyOpen}
        onClick={onToggleHistory}
      >
        <IconHistory />
        <span aria-hidden="true">历史</span>
        <span className="en" aria-hidden="true">
          History
        </span>
      </button>

      <span className="lang-wrap">
        <select
          className="select"
          aria-label="语言"
          value={langId}
          onChange={(e) => onLanguageChange(e.target.value as LangId)}
        >
          {(promptMode
            ? LANGUAGES.filter((l) => l.id === 'plaintext' || l.id === 'markdown')
            : LANGUAGES
          ).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className={`lang-badge ${manualOverride ? 'manual' : 'auto'}`}>
          {langAuto ? '自动' : '手动'}
        </span>
      </span>

      <span className={`ph-nav ${phState}`} role="group" aria-label="占位符导航">
        {allReplaced ? (
          <IconCheck className="ph-check" size={13} />
        ) : (
          <span className="ph-dot" aria-hidden="true" />
        )}
        <span className="ph-count" title="待替换占位符数量">
          {placeholderCount} 个待替换
        </span>
        <span className="en" aria-hidden="true">
          {allReplaced ? 'All replaced' : 'To replace'}
        </span>
        <button
          type="button"
          className="ph-btn"
          aria-label="上一个占位符"
          disabled={placeholderCount === 0}
          onClick={onPrevPlaceholder}
        >
          <IconChevronLeft size={13} />
        </button>
        <button
          type="button"
          className="ph-btn"
          aria-label="下一个占位符"
          disabled={placeholderCount === 0}
          onClick={onNextPlaceholder}
        >
          <IconChevronRight size={13} />
        </button>
      </span>

      <span className="spacer" />

      <button
        type="button"
        className="btn ghost icon"
        aria-label="快捷键帮助"
        title="快捷键与使用帮助"
        onClick={onHelp}
      >
        <IconHelp size={17} />
      </button>
      <button
        type="button"
        className="btn ghost icon"
        aria-label="设置"
        title="编辑器设置（键位、字体大小、主题）"
        onClick={onOpenSettings}
      >
        <IconSettings size={17} />
      </button>

      {cloudEnabled && (
        <button
          type="button"
          className={`btn ghost account-btn ${accountLabel ? 'active' : ''}`}
          aria-label="账号"
          title={accountLabel ? `已登录：${accountLabel}` : '登录以同步片段库'}
          onClick={onOpenAccount}
        >
          <IconUser size={15} />
          <span aria-hidden="true">{accountLabel ?? '登录'}</span>
        </button>
      )}

      <select
        className="select"
        aria-label="颜色主题"
        value={theme}
        onChange={(e) => onThemeChange(e.target.value as ThemeId)}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <button
        ref={armedRef}
        type="button"
        className={`btn ${clearArmed ? 'danger' : 'ghost'}`}
        onClick={onClear}
        aria-label={clearArmed ? '确认清空全部内容' : '清空编辑器'}
      >
        <span aria-hidden="true">{clearArmed ? '确认清空？' : '清空'}</span>
        {!clearArmed && (
          <span className="en" aria-hidden="true">
            Clear
          </span>
        )}
      </button>

      <button
        type="button"
        className={`btn copy-btn ${copied ? 'sage' : 'primary'}`}
        disabled={!canCopy}
        onClick={onCopy}
        aria-label="复制"
        title="复制全部内容（Ctrl/Cmd+Enter）"
      >
        {copied ? <IconCheck size={16} /> : <IconCopy />}
        <span aria-hidden="true">{copied ? '已复制' : '复制'}</span>
        <span className="en" aria-hidden="true">
          {copied ? 'Copied' : 'Copy'}
        </span>
        {!copied && (
          <span className="kbd" aria-hidden="true">
            ⌘↵
          </span>
        )}
      </button>
    </header>
  )
}
