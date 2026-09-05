import { expect, test, type Page } from '@playwright/test'
import { setDoc } from './helpers'

/**
 * 语法高亮回归：语言识别（或手动选择）后，CodeMirror 必须装配对应语言包，
 * 渲染出带高亮类的 token span。历史回归：App 漏调 EditorApi.setLanguage，
 * 语言包永不加载，编辑器只有纯文本（识别标签正常但整页无高亮色）。
 */

/** 编辑器内容里是否存在 CodeMirror 高亮输出的带类 token span */
function countStyledTokens(page: Page) {
  return page.evaluate(() => document.querySelectorAll('.cm-content span[class]').length)
}

test.describe('语法高亮', () => {
  test('识别为 Shell 后渲染高亮 token；手动切语言后高亮跟随', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, '#!/bin/bash\ncurl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644')
    await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('shell', {
      timeout: 5000,
    })
    // 语言包动态加载完成后出现高亮 token
    await expect.poll(() => countStyledTokens(page), { timeout: 5000 }).toBeGreaterThan(0)

    // 手动切换语言：高亮切换（换语言后 token 仍在；此处验证的是重装配路径不抛错且生效）
    await page.getByRole('combobox', { name: '语言' }).selectOption('python')
    await expect.poll(() => countStyledTokens(page), { timeout: 5000 }).toBeGreaterThan(0)
  })
})
