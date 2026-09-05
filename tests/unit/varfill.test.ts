import { beforeEach, describe, expect, it } from 'vitest'
import { countWords, estimateTokens } from '../../src/utils/textStats'
import {
  lastVarValues,
  missingVars,
  rememberVarValues,
} from '../../src/utils/varfill'

describe('countWords / estimateTokens（Prompt 状态栏）', () => {
  it('CJK 逐字计数，拉丁按词计数', () => {
    expect(countWords('审查这段代码')).toBe(6)
    expect(countWords('review the code')).toBe(3)
    expect(countWords('审查 review')).toBe(3) // 2 CJK + 1 词
    expect(countWords('')).toBe(0)
  })

  it('token 估算 = 字符数 / 4 向上取整，最小 1', () => {
    expect(estimateTokens(0)).toBe(1)
    expect(estimateTokens(8)).toBe(2)
    expect(estimateTokens(9)).toBe(3)
  })
})

describe('变量值记忆（仅本地语义）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('记住每个变量上次填的值；整表提交语义：清空的变量记忆一并清除', () => {
    rememberVarValues('s1', { 语言: 'Go', 代码: 'x := 1' })
    expect(lastVarValues('s1', ['语言', '代码'])).toEqual({ 语言: 'Go', 代码: 'x := 1' })

    // 表单整表提交：语言被清空 → 下次打开不再预填（可预测，而非恢复旧值）
    rememberVarValues('s1', { 语言: '', 代码: 'y := 2' })
    expect(lastVarValues('s1', ['语言', '代码'])).toEqual({ 语言: '', 代码: 'y := 2' })
  })

  it('按条目隔离；无记录返回空串', () => {
    rememberVarValues('s1', { a: '1' })
    expect(lastVarValues('s2', ['a'])).toEqual({ a: '' })
  })

  it('损坏数据降级为空', () => {
    localStorage.setItem('vimpaste.varfill.v1', '{nope')
    expect(lastVarValues('s1', ['a'])).toEqual({ a: '' })
    expect(() => rememberVarValues('s1', { a: 'x' })).not.toThrow()
  })

  it('missingVars 列出未填写的变量', () => {
    expect(missingVars(['a', 'b'], { a: 'x' })).toEqual(['b'])
    expect(missingVars(['a'], { a: ' ' })).toEqual(['a'])
  })
})
