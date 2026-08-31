import { useEffect, useRef } from 'react'
import { LANGUAGES } from '../detection/language'
import type { LangId } from '../detection/language'
import { THEMES } from '../theme/themes'
import type { ThemeId } from '../theme/themes'
import { IconChevronLeft, IconChevronRight, IconHelp, IconHistory, IconSettings } from './icons'

export interface ToolbarProps {
  langId: LangId
  langAuto: boolean
  manualOverride: boolean
  onLanguageChange: (id: LangId) => void
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
  onOpenSettings: () => void
  onToggleHistory: () => void
  historyOpen: boolean
  placeholderCount: number
  onPrevPlaceholder: () => void
  onNextPlaceholder: () => void
  canCopy: boolean
  onCopy: () => void
  clearArmed: boolean
  onClear: () => void
  onHelp: () => void
}

export function Toolbar(props: ToolbarProps) {
  const {
    langId,
    langAuto,
    manualOverride,
    onLanguageChange,
    theme,
    onThemeChange,
    onOpenSettings,
    onToggleHistory,
    historyOpen,
    placeholderCount,
    onPrevPlaceholder,
    onNextPlaceholder,
    canCopy,
    onCopy,
    clearArmed,
    onClear,
    onHelp,
  } = props

  const armedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (clearArmed) armedRef.current?.focus()
  }, [clearArmed])

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
        className="btn icon"
        aria-label="历史记录"
        title="粘贴历史（保存在本浏览器）"
        aria-expanded={historyOpen}
        onClick={onToggleHistory}
      >
        <IconHistory />
      </button>

      <span className="lang-wrap">
        <select
          className="select"
          aria-label="语言"
          value={langId}
          onChange={(e) => onLanguageChange(e.target.value as LangId)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className={`lang-badge ${manualOverride ? 'manual' : 'auto'}`}>
          {langAuto ? '自动' : '手动'}
        </span>
      </span>

      <button
        type="button"
        className="btn icon"
        aria-label="设置"
        title="编辑器设置（键位、字体大小、主题）"
        onClick={onOpenSettings}
      >
        <IconSettings />
      </button>

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

      <span className="ph-nav" role="group" aria-label="占位符导航">
        <span className="ph-count" title="待替换占位符数量">
          {placeholderCount} 个待替换
        </span>
        <button
          type="button"
          className="btn icon"
          aria-label="上一个占位符"
          disabled={placeholderCount === 0}
          onClick={onPrevPlaceholder}
        >
          <IconChevronLeft />
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="下一个占位符"
          disabled={placeholderCount === 0}
          onClick={onNextPlaceholder}
        >
          <IconChevronRight />
        </button>
      </span>

      <span className="spacer" />

      <button type="button" className="btn ghost icon" aria-label="快捷键帮助" onClick={onHelp}>
        <IconHelp />
      </button>
      <button
        ref={armedRef}
        type="button"
        className={`btn ${clearArmed ? 'danger' : 'ghost'}`}
        onClick={onClear}
        aria-label={clearArmed ? '确认清空全部内容' : '清空编辑器'}
      >
        {clearArmed ? '确认清空？' : '清空'}
      </button>
      <button
        type="button"
        className="btn primary"
        disabled={!canCopy}
        onClick={onCopy}
        title="复制全部内容（Ctrl/Cmd+Enter）"
      >
        复制
      </button>
    </header>
  )
}
