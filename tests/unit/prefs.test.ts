import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/storage/prefs'

const KEY = 'vimpaste.prefs.v1'

describe('prefs（非敏感偏好）', () => {
  it('默认：Vim 键位、字号 14、提示未关闭、深色主题', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.editorMode).toBe('vim')
    expect(DEFAULT_PREFS.fontSize).toBe(14)
  })

  it('保存后读取一致', () => {
    savePrefs({ editorMode: 'emacs', fontSize: 18, hintDismissed: true, theme: 'light' })
    expect(loadPrefs()).toEqual({
      editorMode: 'emacs',
      fontSize: 18,
      hintDismissed: true,
      theme: 'light',
    })
  })

  it('损坏数据回落默认值', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('未知字段与非法值被丢弃（白名单）；旧版 vimEnabled=false 迁移优先', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        editorMode: 'nano',
        fontSize: 999,
        evil: 'x',
        doc: 'secret',
        vimEnabled: false,
      }),
    )
    const prefs = loadPrefs()
    expect(prefs).toEqual({
      editorMode: 'standard',
      fontSize: 20,
      hintDismissed: false,
      theme: 'dark',
    })
    expect(JSON.stringify(prefs)).not.toContain('secret')
  })

  it('非法 editorMode 且无旧版字段时回落默认', () => {
    localStorage.setItem(KEY, JSON.stringify({ editorMode: 'nano' }))
    expect(loadPrefs().editorMode).toBe('vim')
  })

  it('旧版本 vimEnabled=false 迁移为普通编辑器模式', () => {
    localStorage.setItem(KEY, JSON.stringify({ vimEnabled: false }))
    expect(loadPrefs()).toEqual({
      editorMode: 'standard',
      fontSize: 14,
      hintDismissed: false,
      theme: 'dark',
    })
  })

  it('savePrefs 后 localStorage 中不存在编辑内容字段', () => {
    savePrefs({ editorMode: 'vim', fontSize: 14, hintDismissed: false, theme: 'contrast' })
    const raw = localStorage.getItem(KEY) ?? ''
    expect(raw).toBe(
      JSON.stringify({ editorMode: 'vim', fontSize: 14, hintDismissed: false, theme: 'contrast' }),
    )
  })
})
