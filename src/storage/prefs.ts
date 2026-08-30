/**
 * 非敏感偏好存储：只允许保存显式白名单内的偏好
 * （Vim 开关、提示关闭状态、颜色主题）。
 * 编辑器内容绝不写入 localStorage / sessionStorage / IndexedDB / URL / 日志。
 */

import { DEFAULT_THEME, isThemeId } from '../theme/themes'
import type { ThemeId } from '../theme/themes'

export interface Prefs {
  vimEnabled: boolean
  hintDismissed: boolean
  theme: ThemeId
}

const STORAGE_KEY = 'vimpaste.prefs.v1'

export const DEFAULT_PREFS: Prefs = {
  vimEnabled: true,
  hintDismissed: false,
  theme: DEFAULT_THEME,
}

function sanitize(raw: unknown): Prefs {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    vimEnabled:
      typeof source.vimEnabled === 'boolean' ? source.vimEnabled : DEFAULT_PREFS.vimEnabled,
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
