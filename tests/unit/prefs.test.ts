import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/storage/prefs'

const KEY = 'vimpaste.prefs.v1'

describe('prefs（非敏感偏好）', () => {
  it('默认：Vim 开启、提示未关闭', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('保存后读取一致', () => {
    savePrefs({ vimEnabled: false, hintDismissed: true })
    expect(loadPrefs()).toEqual({ vimEnabled: false, hintDismissed: true })
  })

  it('损坏数据回落默认值', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('未知字段被丢弃（白名单）', () => {
    localStorage.setItem(KEY, JSON.stringify({ vimEnabled: false, evil: 'x', doc: 'secret' }))
    const prefs = loadPrefs()
    expect(prefs).toEqual({ vimEnabled: false, hintDismissed: false })
    expect(JSON.stringify(prefs)).not.toContain('secret')
  })

  it('savePrefs 后 localStorage 中不存在编辑内容字段', () => {
    savePrefs({ vimEnabled: true, hintDismissed: false })
    const raw = localStorage.getItem(KEY) ?? ''
    expect(raw).toBe(JSON.stringify({ vimEnabled: true, hintDismissed: false }))
  })
})
