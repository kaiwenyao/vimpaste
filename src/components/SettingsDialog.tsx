import { Dialog } from './Dialog'
import { EDITOR_MODE_INFOS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../editor/editorMode'
import type { EditorMode } from '../editor/editorMode'
import { THEMES } from '../theme/themes'
import type { ThemeId } from '../theme/themes'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  editorMode: EditorMode
  onEditorModeChange: (mode: EditorMode) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
}

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    open,
    onClose,
    editorMode,
    onEditorModeChange,
    fontSize,
    onFontSizeChange,
    theme,
    onThemeChange,
  } = props
  return (
    <Dialog open={open} onClose={onClose} title="编辑器设置" closeLabel="关闭设置">
      <section className="settings-section">
        <div className="settings-head">
          <h3 id="settings-mode-label">编辑器键位</h3>
          <span className="en">Key bindings</span>
        </div>
        <div role="radiogroup" aria-labelledby="settings-mode-label" className="mode-options">
          {EDITOR_MODE_INFOS.map((info) => (
            <label
              key={info.id}
              className={`mode-option ${editorMode === info.id ? 'active' : ''}`}
            >
              <input
                type="radio"
                name="editor-mode"
                value={info.id}
                checked={editorMode === info.id}
                onChange={() => onEditorModeChange(info.id)}
              />
              <span className="mode-option-text">
                <span className="mode-option-label">{info.label}</span>
                <span className="mode-option-desc">{info.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <h3 id="settings-font-label">字体大小</h3>
          <span className="en">Font size</span>
        </div>
        <div className="font-size-row">
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            aria-labelledby="settings-font-label"
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
          />
          <output className="font-size-value">{fontSize}px</output>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <h3 id="settings-theme-label">颜色主题</h3>
          <span className="en">Theme</span>
        </div>
        <select
          className="select"
          aria-labelledby="settings-theme-label"
          value={theme}
          onChange={(e) => onThemeChange(e.target.value as ThemeId)}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </section>

      <p className="help-note">
        偏好保存在本浏览器。Emacs 模式提供 Ctrl-a/e/k/b/f 等 readline 键位；Vim 模式下 ]v / [v
        仍可跳转占位符。
        <br />
        <span className="en">Preferences stay local; editor content is never uploaded.</span>
      </p>
    </Dialog>
  )
}
