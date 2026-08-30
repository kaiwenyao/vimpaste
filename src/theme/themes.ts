/** 颜色主题：非敏感偏好，保存在 localStorage（见 storage/prefs.ts）。 */

export const THEME_IDS = ['dark', 'light', 'contrast'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeInfo {
  id: ThemeId
  label: string
}

export const THEMES: ThemeInfo[] = [
  { id: 'dark', label: '深色' },
  { id: 'light', label: '浅色' },
  { id: 'contrast', label: '高对比' },
]

export const DEFAULT_THEME: ThemeId = 'dark'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}
