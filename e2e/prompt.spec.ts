import { expect, test, type Page } from '@playwright/test'

/**
 * Prompt 类型端到端（plan-v2-accounts.md Phase 5 验收）：
 * 建 prompt → 存 → 刷新 → 搜到 → 恢复 → 复制（匿名本地路径即可完成）。
 */

const PROMPT = '请审查下面的 {{语言}} 代码，关注边界条件：\n{{代码}}\n背景：[请填写背景]'

async function openPanel(page: Page) {
  const panel = page.locator('.history-panel')
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole('button', { name: '历史记录' }).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

async function setDoc(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.__vimpaste?.setDoc(t), text)
}

async function getDoc(page: Page): Promise<string> {
  return page.evaluate(() => window.__vimpaste?.getDoc() ?? '')
}

test.describe('Prompt 类型片段', () => {
  test('新建 Prompt → 软换行与 {{变量}} 占位符 → 存 → 刷新 → 搜到 → 恢复 → 复制', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')

    // 新建 Prompt：编辑器切到 prompt 形态
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: '新建 Prompt' }).click()
    await setDoc(page, PROMPT)

    // 状态栏切换为字数 + 预估 token（估算），语言标签隐藏
    const status = page.locator('.statusbar')
    await expect(status).toContainText('字')
    await expect(status).toContainText('tokens（估算）')

    // {{变量}} ×2 与 [请填写背景] 都被标记为占位符，]v 可跳转
    await expect(page.getByText('3 个待替换')).toBeVisible()
    await page.keyboard.press(']')
    await page.keyboard.press('v')
    await expect(page.locator('.cm-vp-placeholder').first()).toBeVisible()

    // 变量填充表单出现且未填完时禁用「填充并复制」
    const varfill = page.locator('.varfill')
    await expect(varfill.getByRole('textbox', { name: '变量 语言 的值' })).toBeVisible()
    await expect(varfill.getByRole('button', { name: '填充并复制' })).toBeDisabled()
    await varfill.getByRole('textbox', { name: '变量 语言 的值' }).fill('TypeScript')
    await varfill.getByRole('textbox', { name: '变量 代码 的值' }).fill('let x = 1')
    await expect(varfill.getByRole('button', { name: '填充并复制' })).toBeEnabled()
    // 「填充并复制」写入变量值记忆（仅本地，vimpaste.varfill.v1）
    await page.evaluate((t) => navigator.clipboard.writeText(t), 'sentinel')
    await varfill.getByRole('button', { name: '填充并复制' }).click()
    // 按钮就地变为「已复制」（可访问名保持「填充并复制」，检查可见文本）
    await expect(varfill.getByRole('button', { name: '填充并复制' })).toContainText('已复制')

    // 防抖落盘后刷新：条目在库面板中可搜到
    await page.waitForTimeout(2000)
    await page.reload()
    const reopened = await openPanel(page)
    // prompt 类型筛选 chip 生效
    await reopened.getByRole('button', { name: 'Prompt', exact: true }).click()
    await reopened.getByRole('textbox', { name: '搜索历史' }).fill('边界条件')
    await reopened.getByRole('button', { name: /^请审查下面的/ }).click()
    expect(await getDoc(page)).toBe(PROMPT)

    // 恢复后仍是 prompt 形态：变量填充表单在，且记住上次填的值（仅本地）
    await expect(page.locator('.varfill').getByRole('textbox', { name: '变量 语言 的值' })).toHaveValue(
      'TypeScript',
    )

    // 普通复制保持原文（模板不被改写）
    await page.evaluate((t) => navigator.clipboard.writeText(t), 'sentinel')
    // exact 匹配：区分工具栏「复制」与变量表单「填充并复制」
    await page.getByRole('button', { name: '复制', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('已复制到剪贴板')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(PROMPT)
  })

  test('填充并复制：得到替换后的成品，原文不被修改', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: '新建 Prompt' }).click()
    await setDoc(page, PROMPT)
    const varfill = page.locator('.varfill')
    await varfill.getByRole('textbox', { name: '变量 语言 的值' }).fill('Python')
    await varfill.getByRole('textbox', { name: '变量 代码 的值' }).fill('print(1)')

    await page.evaluate((t) => navigator.clipboard.writeText(t), 'sentinel')
    await varfill.getByRole('button', { name: '填充并复制' }).click()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(
      '请审查下面的 Python 代码，关注边界条件：\nprint(1)\n背景：[请填写背景]',
    )
    // 原文不动
    expect(await getDoc(page)).toBe(PROMPT)
  })

  test('切回命令形态：长行不换行、语言识别恢复', async ({ page }) => {
    await page.goto('/')
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: '新建 Prompt' }).click()
    // prompt 形态：语言下拉只剩 纯文本 / Markdown
    const langSelect = page.getByRole('combobox', { name: '语言' })
    await expect(langSelect.locator('option')).toHaveCount(2)

    // 抽屉形态下新建后自动收起，重新打开再点「新建粘贴」
    const reopenedPanel = await openPanel(page)
    await reopenedPanel.getByRole('button', { name: '新建粘贴' }).click()
    await expect(langSelect.locator('option')).toHaveCount(12)
    // 命令形态：识别生效
    await setDoc(page, "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -")
    await expect(langSelect).toHaveValue('shell', { timeout: 5000 })
  })
})
