import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/storage/prefs'

const KEY = 'vimpaste.prefs.v1'

describe('prefs（非敏感偏好）', () => {
  it('默认：Vim 开启、提示未关闭、深色主题', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.theme).toBe('dark')
  })

  it('保存后读取一致', () => {
    savePrefs({ vimEnabled: false, hintDismissed: true, theme: 'light' })
    expect(loadPrefs()).toEqual({ vimEnabled: false, hintDismissed: true, theme: 'light' })
  })

  it('损坏数据回落默认值', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('未知字段与非法主题被丢弃（白名单）', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ vimEnabled: false, theme: 'rainbow', evil: 'x', doc: 'secret' }),
    )
    const prefs = loadPrefs()
    expect(prefs).toEqual({ vimEnabled: false, hintDismissed: false, theme: 'dark' })
    expect(JSON.stringify(prefs)).not.toContain('secret')
  })

  it('savePrefs 后 localStorage 中不存在编辑内容字段', () => {
    savePrefs({ vimEnabled: true, hintDismissed: false, theme: 'contrast' })
    const raw = localStorage.getItem(KEY) ?? ''
    expect(raw).toBe(JSON.stringify({ vimEnabled: true, hintDismissed: false, theme: 'contrast' }))
  })
})
