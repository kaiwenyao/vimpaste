import { expect, test } from '@playwright/test'
import { K3S, getDoc, setDoc } from './helpers'

const ITEM = /^curl -sfL https/

test.describe('粘贴历史', () => {
  test('粘贴 → 防抖保存 → 刷新后仍在 → 点击恢复到编辑器', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)

    const panel = page.getByRole('dialog', { name: '粘贴历史' })
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel).toBeVisible()
    await expect(panel.getByText('仅保存在本浏览器 · 不上传')).toBeVisible()
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible({ timeout: 5000 })

    // 刷新：编辑器从空白开始，历史保留
    await page.reload()
    expect(await getDoc(page)).toBe('')
    await page.getByRole('button', { name: '历史记录' }).click()
    await panel.getByRole('button', { name: ITEM }).click()
    await expect(page.locator('.cm-content')).toContainText('curl -sfL https://get.k3s.io')
    expect(await getDoc(page)).toBe(K3S)
    // 窄视口下点击条目后侧栏自动关闭；宽视口保持打开。两种状态都能看到当前条目高亮
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: '历史记录' }).click()
    }
    await expect(panel.locator('.history-row.active')).toBeVisible()
  })

  test('搜索过滤、删除单条与清空全部', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    const panel = page.getByRole('dialog', { name: '粘贴历史' })
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible({ timeout: 5000 })

    // 搜索：命中
    await panel.getByRole('textbox', { name: '搜索历史' }).fill('k3s.io')
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible()
    // 搜索：无命中
    await panel.getByRole('textbox', { name: '搜索历史' }).fill('不存在的命令')
    await expect(panel.getByText(/没有匹配「不存在的命令」的历史/)).toBeVisible()
    await panel.getByRole('textbox', { name: '搜索历史' }).fill('')

    // 删除单条（悬停出现的按钮在移动端常显，直接点）
    await panel.getByRole('button', { name: /删除「curl -sfL/ }).click()
    await expect(panel.getByText('暂无历史记录')).toBeVisible()
    const stored = await page.evaluate(() => localStorage.getItem('vimpaste.history.v1'))
    expect(stored).toBeNull()
  })

  test('关闭自动保存后清空且不再写入；Esc 关闭面板', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    const panel = page.getByRole('dialog', { name: '粘贴历史' })
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible({ timeout: 5000 })

    await panel.getByRole('switch', { name: '自动保存' }).click()
    await expect(panel.getByText(/历史已关闭/)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('vimpaste.history.v1'))).toBeNull()

    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
  })
})
