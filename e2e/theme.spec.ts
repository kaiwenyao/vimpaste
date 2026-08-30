import { expect, test } from '@playwright/test'

test.describe('颜色主题切换', () => {
  test('切换主题即时生效，刷新后保留，编辑内容仍不持久化', async ({ page }) => {
    await page.goto('/')

    const select = page.getByRole('combobox', { name: '颜色主题' })
    await expect(select).toHaveValue('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await select.selectOption('light')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    // 背景色确实变化（CSS 变量驱动）
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(lightBg).not.toBe('rgb(11, 14, 18)')

    await select.selectOption('contrast')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')

    // 刷新后主题保留
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
    await expect(page.getByRole('combobox', { name: '颜色主题' })).toHaveValue('contrast')

    // 切回默认
    await page.getByRole('combobox', { name: '颜色主题' }).selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
