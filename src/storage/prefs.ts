/**
 * 非敏感偏好存储：只允许保存显式白名单内的偏好
 * （编辑器键位、字号、颜色主题、提示关闭状态）。
 * 编辑器内容绝不写入 localStorage / sessionStorage / IndexedDB / URL / 日志。
 */

import { isEditorMode, normalizeFontSize } from '../editor/editorMode'
import type { EditorMode } from '../editor/editorMode'
import { DEFAULT_THEME, isThemeId } from '../theme/themes'
import type { ThemeId } from '../theme/themes'

export interface Prefs {
  editorMode: EditorMode
  fontSize: number
  hintDismissed: boolean
  theme: ThemeId
}

const STORAGE_KEY = 'vimpaste.prefs.v1'

export const DEFAULT_PREFS: Prefs = {
  editorMode: 'vim',
  fontSize: 14,
  hintDismissed: false,
  theme: DEFAULT_THEME,
}

function sanitize(raw: unknown): Prefs {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  // 兼容旧版本：只存过 vimEnabled 布尔值时迁移为 editorMode
  const legacyVimEnabled = typeof source.vimEnabled === 'boolean' ? source.vimEnabled : null
  return {
    editorMode: isEditorMode(source.editorMode)
      ? source.editorMode
      : legacyVimEnabled === false
        ? 'standard'
        : DEFAULT_PREFS.editorMode,
    fontSize: normalizeFontSize(source.fontSize),
    hintDismissed:
      typeof source.hintDismissed === 'boolean'
        ? source.hintDismissed
        : DEFAULT_PREFS.hintDismissed,
    theme: isThemeId(source.theme) ? source.theme : DEFAULT_PREFS.theme,
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 存储不可用（如隐私模式）时静默忽略：偏好丢失可接受，内容本来就不落盘 */
  }
}
