/** 编辑器键位模式与字号设置（NeetCode 风格）：非敏感偏好，保存在 localStorage。 */

export const EDITOR_MODES = ['standard', 'vim', 'emacs'] as const

export type EditorMode = (typeof EDITOR_MODES)[number]

export interface EditorModeInfo {
  id: EditorMode
  label: string
  description: string
}

export const EDITOR_MODE_INFOS: EditorModeInfo[] = [
  { id: 'standard', label: '普通编辑器', description: '标准文本框行为，方向键与快捷键与系统一致' },
  { id: 'vim', label: 'Vim', description: '模态编辑：Normal/Insert/Visual/Command-line' },
  { id: 'emacs', label: 'Emacs', description: 'Ctrl-a/e/k/b/f 等 readline 风格键位' },
]

export function isEditorMode(value: unknown): value is EditorMode {
  return typeof value === 'string' && (EDITOR_MODES as readonly string[]).includes(value)
}

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 20
export const DEFAULT_FONT_SIZE = 14

export function normalizeFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))
}
