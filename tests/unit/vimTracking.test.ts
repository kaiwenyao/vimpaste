import { getCM } from '@replit/codemirror-vim'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor } from '../../src/editor/createEditor'
import { attachVimModeTracking } from '../../src/editor/vimSetup'

const callbacks = {
  onDocChanged: () => {},
  onCursor: () => {},
  onPlaceholderCount: () => {},
  onVimMode: () => {},
}

/** facade._handlers 由 CM5 兼容层维护（含库内部监听器），只做相对断言 */
function modeListenerCount(view: Parameters<typeof getCM>[0]): number {
  return getCM(view)?._handlers?.['vim-mode-change']?.length ?? 0
}

function createEditorInBody(editorMode: 'vim' | 'standard' | 'emacs' = 'vim') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const api = createEditor(host, callbacks, { editorMode })
  return {
    api,
    cleanup: () => {
      api.destroy()
      host.remove()
    },
  }
}

describe('Vim 模式跟踪挂接（幂等）', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('同一 facade 重复挂接不累积监听器', () => {
    const { api, cleanup } = createEditorInBody('vim')
    try {
      const initial = modeListenerCount(api.view)
      expect(initial).toBeGreaterThan(0)

      attachVimModeTracking(api.view, () => {})
      attachVimModeTracking(api.view, () => {})
      expect(modeListenerCount(api.view)).toBe(initial)
    } finally {
      cleanup()
    }
  })

  it('compartment 切走再切回后，重建的 facade 上仍只注册一次且事件可达', () => {
    const onVimMode = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const api = createEditor(host, { ...callbacks, onVimMode }, { editorMode: 'vim' })
    try {
      const initial = modeListenerCount(api.view)
      api.setEditorMode('standard')
      expect(getCM(api.view)).toBeNull()
      onVimMode.mockClear() // 切到 standard 时已回调 null

      api.setEditorMode('vim')
      // 重建的 facade 上重新挂接成功，并立即上报当前模式
      expect(modeListenerCount(api.view)).toBe(initial)
      expect(onVimMode).toHaveBeenCalledWith('NORMAL')

      // 同一 facade 重复挂接不重复注册，原有回调仍可达
      attachVimModeTracking(api.view, () => {})
      expect(modeListenerCount(api.view)).toBe(initial)
      getCM(api.view)!.signal('vim-mode-change', { mode: 'NORMAL' })
      expect(onVimMode).toHaveBeenCalledTimes(2)
      expect(onVimMode).toHaveBeenNthCalledWith(2, 'NORMAL')
    } finally {
      api.destroy()
      host.remove()
    }
  })
})
