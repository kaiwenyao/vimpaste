import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { getDoc, getSelection, setDoc, setSel } from './helpers'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('dialog', { name: '编辑器设置' })).toBeVisible()
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: '关闭设置' }).click()
  await expect(page.getByRole('dialog', { name: '编辑器设置' })).toBeHidden()
}

async function chooseMode(page: Page, modeLabel: string): Promise<void> {
  await openSettings(page)
  await page.getByRole('radio', { name: new RegExp(modeLabel) }).click()
  await closeSettings(page)
}

test.describe('编辑器设置（键位模式与字体大小）', () => {
  test('设置面板可访问：键位单选、字号滑块、主题下拉', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '编辑器设置' })
    await expect(page.getByRole('radiogroup', { name: '编辑器键位' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /普通编辑器/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /^Vim/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Emacs/ })).toBeVisible()
    await expect(page.getByRole('slider', { name: '字体大小' })).toHaveValue('14')
    await expect(dialog.getByRole('combobox', { name: '颜色主题' })).toHaveValue('dark')
    await closeSettings(page)
  })

  test('普通编辑器模式：按键直接输入，全选覆盖符合文本框语义', async ({ page }) => {
    await page.goto('/')
    await chooseMode(page, '普通编辑器')
    await page.locator('.cm-content').click()
    await page.keyboard.type('echo ready')
    expect(await getDoc(page)).toBe('echo ready')
    // 标准文本框语义：Ctrl/Cmd+A 全选后输入直接覆盖
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('sudo ')
    expect(await getDoc(page)).toBe('sudo ')
  })

  test('Emacs 模式：Ctrl+a/e 行首行尾，Ctrl+k 删到行尾', async ({ page }) => {
    await page.goto('/')
    await chooseMode(page, 'Emacs')
    await setDoc(page, 'abc def\nghi\n')
    await setSel(page, 0)
    await page.keyboard.press('Control+a')
    expect((await getSelection(page)).head).toBe(0)
    await page.keyboard.press('Control+e')
    expect((await getSelection(page)).head).toBe(7)
    // 光标在行尾时按 emacs kill-line 语义连换行符一起删除，下一行上移
    await page.keyboard.press('Control+k')
    expect(await getDoc(page)).toBe('abc defghi\n')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('xyz ')
    expect(await getDoc(page)).toBe('xyz abc defghi\n')
  })

  test('Vim 模式：切换后模态编辑与 ]v 依旧可用', async ({ page }) => {
    await page.goto('/')
    await chooseMode(page, '普通编辑器')
    await chooseMode(page, 'Vim')
    await setDoc(page, "curl x | K3S_TOKEN='YOUR_TOKEN' sh -s -")
    await setSel(page, 0)
    await page.keyboard.press(']')
    await page.keyboard.press('v')
    const sel = await getSelection(page)
    expect((await getDoc(page)).slice(sel.anchor, sel.head)).toBe('YOUR_TOKEN')
    await page.keyboard.press('c')
    await page.keyboard.insertText('MY_TOKEN')
    await page.keyboard.press('Escape')
    expect(await getDoc(page)).toBe("curl x | K3S_TOKEN='MY_TOKEN' sh -s -")
  })

  test('字体大小：滑块即时生效并持久化', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('slider', { name: '字体大小' }).fill('18')
    await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px')
    await closeSettings(page)
    await page.reload()
    await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px')
    // 恢复默认
    await openSettings(page)
    await page.getByRole('slider', { name: '字体大小' }).fill('14')
    await closeSettings(page)
  })
})
