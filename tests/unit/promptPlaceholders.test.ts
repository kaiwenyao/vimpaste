import { describe, expect, it } from 'vitest'
import {
  fillPromptTemplate,
  findPromptPlaceholders,
  parsePromptVariables,
} from '../../src/detection/placeholders'

describe('findPromptPlaceholders（{{变量}} / [待填写] / 【主题】）', () => {
  it('识别 {{变量}}，name 取花括号内 trim 后的文本', () => {
    const matches = findPromptPlaceholders('请审查 {{ 语言 }} 代码：\n{{代码}}')
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ kind: 'variable', name: '语言', text: '{{ 语言 }}' })
    expect(matches[1]).toMatchObject({ kind: 'variable', name: '代码' })
  })

  it('识别 [待填写] 与【主题】为 prose', () => {
    const matches = findPromptPlaceholders('背景：[请填写背景]\n主题：【某主题】')
    expect(matches.map((m) => m.kind)).toEqual(['prose', 'prose'])
  })

  it('空文本与超长文本返回空数组', () => {
    expect(findPromptPlaceholders('')).toEqual([])
    expect(findPromptPlaceholders('x'.repeat(200_001))).toEqual([])
  })

  it('command 规则不受影响（YOUR_TOKEN 仍由 findPlaceholders 识别）', () => {
    // prompt 规则不标记 YOUR_TOKEN：两套规则不混用，kind 决定走哪一个
    expect(findPromptPlaceholders("curl x | TOKEN='YOUR_TOKEN'")).toEqual([])
  })
})

describe('parsePromptVariables', () => {
  it('按出现顺序去重提取变量名', () => {
    expect(parsePromptVariables('{{a}} 和 {{ b }} 与 {{a}}')).toEqual(['a', 'b'])
  })

  it('空变量名（{{}} / {{  }}）忽略', () => {
    expect(parsePromptVariables('{{}} {{  }} {{ok}}')).toEqual(['ok'])
  })

  it('无变量返回空数组', () => {
    expect(parsePromptVariables('普通文本，没有变量')).toEqual([])
  })
})

describe('fillPromptTemplate（填充复制，原文不动）', () => {
  it('命中的变量替换，未填写的保持原样', () => {
    const template = '请审查 {{语言}} 代码：\n{{代码}}\n作者：{{作者}}'
    const filled = fillPromptTemplate(template, { 语言: 'TypeScript', 代码: 'let x = 1' })
    expect(filled).toBe('请审查 TypeScript 代码：\nlet x = 1\n作者：{{作者}}')
  })

  it('空字符串值视为未填写（保持占位符）', () => {
    expect(fillPromptTemplate('{{a}}!', { a: '' })).toBe('{{a}}!')
  })

  it('无变量的文本原样返回', () => {
    expect(fillPromptTemplate('plain text', {})).toBe('plain text')
  })
})
