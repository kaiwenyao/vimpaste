import { expect, test, type Page } from '@playwright/test'
import { K3S, getDoc, setDoc } from './helpers'

const ITEM = /^curl -sfL https/
/** 与 App.tsx 的 DOCKED_HISTORY_QUERY 一致：≥ 该宽度面板固定在编辑器左侧 */
const DOCKED_MIN_WIDTH = 768

function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < DOCKED_MIN_WIDTH
}

/** 桌面端固定面板默认展示；窄视口抽屉需点击工具栏按钮展开 */
async function ensurePanelOpen(page: Page) {
  const panel = page.locator('.history-panel')
  if (isNarrow(page)) {
    await page.getByRole('button', { name: '历史记录' }).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

test.describe('粘贴历史', () => {
  test('粘贴 → 防抖保存 → 刷新后仍在 → 点击恢复到编辑器', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)

    const panel = await ensurePanelOpen(page)
    await expect(panel.getByText('仅保存在本浏览器 · 不上传')).toBeVisible()
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible({ timeout: 5000 })

    // 刷新：编辑器从空白开始，历史保留
    await page.reload()
    expect(await getDoc(page)).toBe('')
    const reopened = await ensurePanelOpen(page)
    await reopened.getByRole('button', { name: ITEM }).click()
    await expect(page.locator('.cm-content')).toContainText('curl -sfL https://get.k3s.io')
    expect(await getDoc(page)).toBe(K3S)
    // 窄视口下点击条目后抽屉自动关闭；宽视口固定面板保持打开。两种状态都能看到当前条目高亮
    const finalPanel = await ensurePanelOpen(page)
    await expect(finalPanel.locator('.history-row.active')).toBeVisible()
  })

  test('搜索过滤、删除单条与清空全部', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    const panel = await ensurePanelOpen(page)
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

  test('关闭自动保存后清空且不再写入', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    const panel = await ensurePanelOpen(page)
    await expect(panel.getByRole('button', { name: ITEM })).toBeVisible({ timeout: 5000 })

    await panel.getByRole('switch', { name: '自动保存' }).click()
    await expect(panel.getByText(/历史已关闭/)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('vimpaste.history.v1'))).toBeNull()
  })

  test('桌面端面板固定在左侧：无遮罩、Esc 不关闭、显隐跨刷新记忆', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '固定面板仅桌面宽视口')
    await page.goto('/')
    const panel = page.locator('.history-panel')

    // 默认固定展示，参与布局而不是覆盖弹出
    await expect(panel).toBeVisible()
    await expect(page.locator('.history-backdrop')).toHaveCount(0)

    // Esc 属于 Vim 按键，固定面板不响应
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()

    // 工具栏按钮切换显隐，并跨刷新记忆
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel).toBeHidden()
    await page.reload()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel).toBeVisible()
    await page.reload()
    await expect(panel).toBeVisible()
  })

  test('窄视口收起为抽屉：默认不弹出，可用 Esc 关闭', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })
    await page.goto('/')
    const panel = page.locator('.history-panel')

    // 窄视口下抽屉不自动弹出，不遮挡编辑器
    await expect(panel).toHaveCount(0)
    await page.getByRole('button', { name: '历史记录' }).click()
    await expect(panel).toBeVisible()
    await expect(page.locator('.history-backdrop')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })
})
