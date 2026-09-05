import { expect, test, type Page } from '@playwright/test'
import { K3S, getDoc, setDoc } from './helpers'

const ITEM = /^curl -sfL https/
const HISTORY_KEY = 'vimpaste.history.v1'

/** 从编辑器打开「已保存」片段库页面 */
async function openSaved(page: Page) {
  await page.getByRole('button', { name: '已保存片段' }).click()
  await expect(page.locator('.saved-page')).toBeVisible()
  return page.locator('.saved-page')
}

/** 等语言识别完成后手动保存（保存按钮仅在确有未保存修改时可用） */
async function saveViaToolbar(page: Page) {
  await expect(page.getByRole('button', { name: '保存到片段库' })).toBeEnabled()
  await page.getByRole('button', { name: '保存到片段库' }).click()
  await expect(page.getByRole('status')).toHaveText('已保存到片段库')
}

test.describe('手动保存与片段库', () => {
  test('默认不自动保存：编辑后存储为空，点保存才入库，刷新后可从库中恢复', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('shell', {
      timeout: 5000,
    })

    // 没有任何自动保存：编辑内容不落盘
    await page.waitForTimeout(2000)
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull()
    // 状态栏提示未保存
    await expect(page.locator('.statusbar')).toContainText('未保存')

    // 手动保存入库，状态栏转为已保存
    await saveViaToolbar(page)
    await expect(page.locator('.statusbar')).toContainText('已保存')
    const stored = await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)
    expect(stored).toContain('YOUR_TOKEN')

    // 刷新：编辑器从空白开始，片段保留在库中
    await page.reload()
    expect(await getDoc(page)).toBe('')
    const saved = await openSaved(page)
    await expect(saved.getByRole('button', { name: ITEM })).toBeVisible()

    // 从片段库恢复到编辑器
    await saved.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }).click()
    await expect(page.locator('.cm-content')).toContainText('curl -sfL https://get.k3s.io')
    expect(await getDoc(page)).toBe(K3S)
  })

  test('复制不再写入片段库', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await setDoc(page, K3S)
    await page.getByRole('button', { name: '复制', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('已复制到剪贴板')
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull()
  })

  test('Ctrl/Cmd+S 手动保存', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('shell', {
      timeout: 5000,
    })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByRole('status')).toHaveText('已保存到片段库')
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toContain('YOUR_TOKEN')
  })

  test('详情页展示完整信息：类型 / 语言 / 统计 / 时间 / 同步状态 / 全文', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('shell', {
      timeout: 5000,
    })
    await saveViaToolbar(page)

    const saved = await openSaved(page)
    await saved.getByRole('button', { name: ITEM }).click()

    const detail = page.locator('.detail-page')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.detail-title')).toContainText('curl -sfL https://get.k3s.io')
    await expect(detail.getByText('命令')).toBeVisible()
    // 按字段名定位信息行，避免与其他数字误匹配
    const rowFor = (label: string) => detail.locator('.detail-row', { hasText: label })
    await expect(rowFor('语言').locator('dd')).toHaveText('Shell / Bash')
    await expect(rowFor('字符数').locator('dd')).toHaveText(String(K3S.length))
    await expect(rowFor('行数').locator('dd')).toHaveText(String(K3S.split('\n').length))
    await expect(rowFor('同步状态').locator('dd')).toContainText('仅保存在本机')
    await expect(rowFor('创建时间').locator('dd')).toContainText(/\d{4} 年 \d{1,2} 月 \d{1,2} 日/)
    await expect(rowFor('更新时间').locator('dd')).toContainText(/\d{4} 年 \d{1,2} 月 \d{1,2} 日/)
    // 全文逐字保留
    const pre = detail.locator('.detail-content')
    expect(await pre.textContent()).toBe(K3S)

    // 返回片段列表 → 返回编辑器
    await detail.getByRole('button', { name: '返回片段列表' }).click()
    await expect(page.locator('.saved-page')).toBeVisible()
    await page.locator('.saved-page').getByRole('button', { name: '返回编辑器' }).click()
    await expect(page.locator('.cm-content')).toBeVisible()
    expect(await getDoc(page)).toBe(K3S)
  })

  test('详情页可直接复制条目内容', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)
    const saved = await openSaved(page)
    await saved.getByRole('button', { name: ITEM }).click()
    await page.getByRole('button', { name: '复制内容' }).click()
    await expect(page.getByRole('status')).toContainText('已复制')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(K3S)
  })

  test('有未保存修改时打开条目先确认：保存并继续 / 不保存', async ({ page }) => {
    await page.goto('/')
    // 入库两条：curl 与 docker（docker 为当前活动条目）
    await setDoc(page, K3S)
    await saveViaToolbar(page)
    await page.getByRole('button', { name: '清空编辑器' }).click()
    await page.getByRole('button', { name: '确认清空全部内容' }).click()
    await setDoc(page, 'docker run -d -p 80:80 nginx')
    await saveViaToolbar(page)

    // 修改当前 docker 条目（产生未保存修改），到片段库打开 curl 条目
    await setDoc(page, 'docker run -d -p 80:80 nginx --restart=always')
    const saved = await openSaved(page)
    await saved.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }).click()

    // 确认对话框：保存并继续 → docker 的修改先入库，再载入 curl 条目
    const dialog = page.getByRole('dialog', { name: '有未保存的修改' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '保存并继续' }).click()
    expect(await getDoc(page)).toBe(K3S)
    const stored = await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)
    expect(stored).toContain('--restart=always')

    // 再次制造未保存修改，重新打开片段库后这次选「不保存」
    await setDoc(page, K3S.replace('YOUR_TOKEN', 'DISCARDED'))
    const reopened = await openSaved(page)
    await reopened.getByRole('button', { name: /在编辑器中打开「docker run/ }).click()
    await page
      .getByRole('dialog', { name: '有未保存的修改' })
      .getByRole('button', { name: '不保存' })
      .click()
    // 丢弃 K3S 的未保存修改，载入 docker 条目已保存的版本
    expect(await getDoc(page)).toBe('docker run -d -p 80:80 nginx --restart=always')
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).not.toContain(
      'DISCARDED',
    )
  })

  test('片段库支持搜索与删除单条、清空全部（二次确认）', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)

    const saved = await openSaved(page)
    await saved.getByRole('textbox', { name: '搜索已保存片段' }).fill('k3s.io')
    await expect(saved.getByRole('button', { name: ITEM })).toBeVisible()
    await saved.getByRole('textbox', { name: '搜索已保存片段' }).fill('不存在的命令')
    await expect(saved.getByText(/没有匹配「不存在的命令」的片段/)).toBeVisible()
    await saved.getByRole('textbox', { name: '搜索已保存片段' }).fill('')

    // 删除单条
    await saved.getByRole('button', { name: /删除「curl -sfL/ }).click()
    await expect(saved.getByText('还没有保存过任何内容')).toBeVisible()
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull()

    // 重新入库后清空全部（二次确认）
    await page.locator('.saved-page').getByRole('button', { name: '返回编辑器' }).click()
    await setDoc(page, 'echo hello')
    await saveViaToolbar(page)
    const reopened = await openSaved(page)
    await reopened.getByRole('button', { name: '清空全部片段' }).click()
    await reopened.getByRole('button', { name: '确认清空全部片段' }).click()
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull()
  })

  test('hash 路由：#/saved 与 #/saved/:id 直达，刷新后保持', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)

    const id = await page.evaluate(
      (k) => (JSON.parse(localStorage.getItem(k) ?? '[]') as { id: string }[])[0]?.id ?? '',
      HISTORY_KEY,
    )
    expect(id).not.toBe('')

    // hash 导航直达片段库与详情（等同书签/分享链接的行为）
    await page.evaluate(() => {
      window.location.hash = '/saved'
    })
    await expect(page.locator('.saved-page')).toBeVisible()
    await page.evaluate((entryId) => {
      window.location.hash = `/saved/${entryId}`
    }, id)
    await expect(page.locator('.detail-page')).toBeVisible()
    expect(await page.locator('.detail-content').textContent()).toBe(K3S)

    // 刷新后 hash 路由保持，详情仍然可见
    await page.reload()
    await expect(page.locator('.detail-page')).toBeVisible()
    expect(await page.locator('.detail-content').textContent()).toBe(K3S)
  })
})
