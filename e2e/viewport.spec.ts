import { expect, test } from '@playwright/test'
import { getDoc, setDoc } from './helpers'

test.describe('视口与布局健壮性（桌面 + 移动）', () => {
  test('页面无横向溢出，核心控件可见', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', { name: '复制' })).toBeVisible()
    await expect(page.getByRole('button', { name: '清空编辑器' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下一个占位符' })).toBeVisible()
    await expect(page.getByText('Local only · 未上传')).toBeVisible()
  })

  test('移动/桌面视口都能完成粘贴与复制', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.evaluate((t) => navigator.clipboard.writeText(t), 'echo hello-vimpaste')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+v')
    await expect(page.getByText('0 个待替换')).toBeVisible()
    expect(await getDoc(page)).toBe('echo hello-vimpaste')

    await page.getByRole('button', { name: '复制' }).click()
    await expect(page.getByRole('status')).toHaveText('已复制到剪贴板')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('echo hello-vimpaste')
  })

  test('长命令行横向滚动且不破坏布局', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, `echo ${'x'.repeat(2000)}`)
    await page.locator('.cm-content').click()
    await page.keyboard.press('$')
    await page.waitForTimeout(100)
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    expect(await getDoc(page)).toBe(`echo ${'x'.repeat(2000)}`)
  })
})
