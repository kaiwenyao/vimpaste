import { expect, test, type Page } from '@playwright/test'
import {
  K3S,
  SAVE_BTN,
  SAVE_TOAST,
  SAVED_BTN,
  confirmCurrentKind,
  getDoc,
  saveViaToolbar,
  setDoc,
} from './helpers'

const ITEM = /^curl -sfL https/
const HISTORY_KEY = 'vimpaste.history.v1'

/** 从编辑器打开「已保存」片段库页面 */
async function openSaved(page: Page) {
  await page.getByRole('button', { name: '已保存片段' }).click()
  await expect(page.locator('.saved-page')).toBeVisible()
  return page.locator('.saved-page')
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
    await confirmCurrentKind(page)
    await expect(page.getByRole('status')).toHaveText(SAVE_TOAST)
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
    await expect(detail.getByRole('combobox', { name: '片段类型' })).toHaveValue('command')
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
    // 行号：每个逻辑行一个 .detail-line，行号由 CSS 从 data-line 生成（不进正文文本）
    const lineRows = detail.locator('.detail-line')
    await expect(lineRows).toHaveCount(K3S.split('\n').length)
    await expect(lineRows.first()).toHaveAttribute('data-line', '1')
    await expect(lineRows.last()).toHaveAttribute('data-line', String(K3S.split('\n').length))

    // 返回片段列表 → 返回编辑器
    await detail.getByRole('button', { name: '返回片段列表' }).click()
    await expect(page.locator('.saved-page')).toBeVisible()
    await page.locator('.saved-page').getByRole('button', { name: '返回编辑器' }).click()
    await expect(page.locator('.cm-content')).toBeVisible()
    expect(await getDoc(page)).toBe(K3S)
  })

  test('详情页全文折行显示：超长单行不产生横向滚动', async ({ page }) => {
    const LONG = `https://example.com/${'a'.repeat(400)}`
    await page.goto('/')
    await setDoc(page, LONG)
    await saveViaToolbar(page)

    const saved = await openSaved(page)
    await saved.locator('.saved-list .history-item').first().click()

    const pre = page.locator('.detail-page .detail-content')
    await expect(pre).toBeVisible()
    // 折行只影响排版，原文逐字不变
    expect(await pre.textContent()).toBe(LONG)

    const metrics = await pre.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        lineHeight: parseFloat(style.lineHeight),
        paddingBlock: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        whiteSpace: style.whiteSpace,
      }
    })
    expect(metrics.whiteSpace).toBe('pre-wrap')
    // 不出现横向溢出（+1 容差给亚像素取整）
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    // 确实折成了多行，而不是被裁掉
    expect(metrics.scrollHeight - metrics.paddingBlock).toBeGreaterThan(metrics.lineHeight * 2)

    // flex 容器未被长内容撑宽：页面 → 内容区 → pre 逐级收窄
    const widths = await page.locator('.detail-page').evaluate((pageEl) => {
      const wrap = pageEl.querySelector('.detail-content-wrap') as HTMLElement
      const pre = pageEl.querySelector('.detail-content') as HTMLElement
      return {
        page: pageEl.clientWidth,
        wrap: wrap.getBoundingClientRect().width,
        pre: pre.getBoundingClientRect().width,
      }
    })
    expect(widths.wrap).toBeLessThanOrEqual(widths.page)
    expect(widths.pre).toBeLessThanOrEqual(widths.wrap)
  })

  test('详情页行号：与折行正文逐行对齐，不进无障碍树也不进选区', async ({ page }) => {
    // 含空行与超长行：验证多行、折行、空行三种情况下的行号行为
    const LONG = `https://example.com/${'a'.repeat(300)}`
    const MULTI = ['alpha', LONG, '', 'gamma'].join('\n')
    await page.goto('/')
    await setDoc(page, MULTI)
    await saveViaToolbar(page)
    const saved = await openSaved(page)
    await saved.locator('.saved-list .history-item').first().click()

    const pre = page.locator('.detail-page .detail-content')
    await expect(pre).toBeVisible()
    // 4 个逻辑行（含 1 个空行），行号与「行数」字段一致
    const rows = pre.locator('.detail-line')
    await expect(rows).toHaveCount(4)
    await expect(rows.last()).toHaveAttribute('data-line', '4')
    const lineRow = page.locator('.detail-page .detail-row', { hasText: '行数' })
    await expect(lineRow.locator('dd')).toHaveText('4')

    // 每行都是「行号列 + 正文」两栏：长行折行后该行更高，但正文仍从同一条左边缘开始
    const geometry = await rows.evaluateAll((els) =>
      els.map((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return {
          height: Math.round(el.getBoundingClientRect().height),
          hasText: (el.textContent ?? '').trim() !== '',
          textLeft: Math.round(range.getBoundingClientRect().left),
        }
      }),
    )
    expect(geometry[1].height).toBeGreaterThan(geometry[0].height)
    const textLefts = geometry.filter((g) => g.hasText).map((g) => g.textLeft)
    expect(new Set(textLefts).size).toBe(1)
    const preLeft = await pre.evaluate((el) => Math.round(el.getBoundingClientRect().left))
    // 正文右移出了行号列（行号占位真实存在）
    expect(textLefts[0]).toBeGreaterThan(preLeft + 4)
    // 空行也占一行高度，行号不会叠在上一个行号上
    expect(geometry[2].height).toBeGreaterThan(0)

    // 行号是 CSS 生成内容：无障碍树里读不到（内容无数字，出现数字就说明行号泄进去了）
    expect(await pre.ariaSnapshot()).not.toMatch(/[0-9]/)

    // 手动全选只拿到正文（行号不参与选区，因此也不会被复制）
    const selected = await pre.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return selection?.toString()
    })
    expect(selected).toBe(MULTI)
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

    // 删除单条：先弹窗确认（点删除不会直接消失），确认后进回收站，内容仍在存储里
    await saved.getByRole('button', { name: /删除「curl -sfL/ }).click()
    const confirmDelete = page.getByRole('dialog', { name: /^删除「curl -sfL/ })
    await expect(confirmDelete).toBeVisible()
    // 遮罩必须铺满整个视口：挂在 .page 里时会被 `.page > *` 的 880px 限宽压成中间一条竖条
    const backdropBox = await page.locator('.dialog-backdrop').boundingBox()
    const viewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }))
    expect(backdropBox?.x).toBe(0)
    expect(backdropBox?.y).toBe(0)
    expect(backdropBox?.width).toBe(viewport.width)
    expect(backdropBox?.height).toBe(viewport.height)
    await expect(saved.getByRole('button', { name: ITEM })).toBeVisible()
    await confirmDelete.getByRole('button', { name: /^确认删除「curl -sfL/ }).click()
    await expect(saved.getByText('还没有保存过任何内容')).toBeVisible()
    const afterDelete = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '[]') as { deletedAt: number | null }[],
      HISTORY_KEY,
    )
    expect(afterDelete).toHaveLength(1)
    expect(afterDelete[0].deletedAt).not.toBeNull()

    // 重新入库后清空全部（二次确认）：也是在用条目进回收站，不再是直接抹掉
    await page.locator('.saved-page').getByRole('button', { name: '返回编辑器' }).click()
    await setDoc(page, 'echo hello')
    await saveViaToolbar(page)
    const reopened = await openSaved(page)
    await reopened.getByRole('button', { name: '清空全部片段（可在回收站恢复）' }).click()
    await reopened.getByRole('button', { name: '确认清空全部片段（可在回收站恢复）' }).click()
    const afterClear = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '[]') as { deletedAt: number | null }[],
      HISTORY_KEY,
    )
    // 两条都在回收站里（不是被删掉），列表为空
    expect(afterClear).toHaveLength(2)
    expect(afterClear.every((s) => s.deletedAt !== null)).toBe(true)
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

test.describe('片段标题与备注；新片段 / 编辑中 标识', () => {
  test('未保存内容显示「新片段」栏；填写标题与备注后保存入库', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)

    // 新片段栏出现：徽标 + 说明 + 两个输入框
    await expect(page.locator('.meta-badge.new')).toBeVisible()
    await expect(page.getByText('尚未保存 · 点「保存为新片段」进入片段库')).toBeVisible()
    await page.getByRole('textbox', { name: '新片段标题' }).fill('重装 k3s')
    await page.getByRole('textbox', { name: '新片段备注' }).fill('master 节点的安装脚本')
    await saveViaToolbar(page)

    // 入库内容带自定义标题与备注
    const stored = await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)
    expect(stored).toContain('重装 k3s')
    expect(stored).toContain('master 节点的安装脚本')

    // 保存后切换为「编辑中」栏，输入框显示已入库的值
    await expect(page.locator('.meta-badge.edit')).toBeVisible()
    await expect(page.locator('.meta-badge.new')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '片段标题' })).toHaveValue('重装 k3s')

    // 片段库列表显示备注，详情页备注行逐字一致
    const saved = await openSaved(page)
    await expect(saved.locator('.history-item-note')).toHaveText('master 节点的安装脚本')
    await saved.getByRole('button', { name: /^重装 k3s/ }).click()
    await expect(page.locator('.detail-title')).toHaveText('重装 k3s')
    await expect(page.locator('.detail-row', { hasText: '备注' }).locator('dd')).toHaveText(
      'master 节点的安装脚本',
    )
  })

  test('载入已有片段显示「编辑中」；改标题失焦即入库，改内容保存后标题保留', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)
    // 清空后编辑器为空：两栏都不显示
    await page.getByRole('button', { name: '清空编辑器' }).click()
    await page.getByRole('button', { name: '确认清空全部内容' }).click()
    await expect(page.locator('.meta-badge.new')).toHaveCount(0)
    await expect(page.locator('.meta-badge.edit')).toHaveCount(0)

    // 从片段库载入：进入「编辑中」态
    const saved = await openSaved(page)
    await saved.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }).click()
    await expect(page.locator('.meta-badge.edit')).toBeVisible()

    // 标题失焦即入库
    const titleInput = page.getByRole('textbox', { name: '片段标题' })
    await titleInput.fill('重装 k3s 脚本')
    await titleInput.blur()
    let stored = await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)
    expect(stored).toContain('重装 k3s 脚本')

    // 修改内容再保存：自定义标题不被自动标题覆盖
    await setDoc(page, K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    await saveViaToolbar(page)
    stored = await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)
    expect(stored).toContain('重装 k3s 脚本')
    expect(stored).toContain('MY_TOKEN')
    expect(stored).not.toContain('YOUR_TOKEN')
  })
  test('编辑已有片段时真实粘贴只修改内容，保存写回本条', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)

    // 从片段库打开这条，进入「编辑中」
    const saved = await openSaved(page)
    await saved.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }).click()
    await expect(page.locator('.meta-badge.edit')).toBeVisible()

    // 真实剪贴板粘贴：]v 选中 YOUR_TOKEN，c 进入插入后粘贴替换值
    await page.locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await page.keyboard.press(']')
    await page.keyboard.press('v')
    await page.keyboard.press('c')
    await page.evaluate(() => navigator.clipboard.writeText('MY_TOKEN'))
    await page.keyboard.press('ControlOrMeta+v')
    await page.keyboard.press('Escape')

    // 粘贴后身份不变：仍是「编辑中」，保存按钮仍是「保存修改」
    await expect(page.locator('.meta-badge.edit')).toBeVisible()
    await expect(page.locator('.meta-badge.new')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^保存修改到「curl -sfL/ })).toBeEnabled()
    expect(await getDoc(page)).toBe(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))

    await saveViaToolbar(page)
    const rows = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '[]') as { content: string }[],
      HISTORY_KEY,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe(K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
  })
  test('保存按钮随去向改文案：新片段「保存为新片段」→ 编辑中「保存修改」，并显示编辑目标', async ({
    page,
  }) => {
    await page.goto('/')
    await setDoc(page, K3S)

    // 新片段：按钮明说「新建一条」，紧邻胶囊说明这些内容还没入库
    const newButton = page.getByRole('button', { name: SAVE_BTN })
    await expect(newButton).toBeEnabled()
    await expect(newButton).toContainText('保存为新片段')
    await expect(newButton).toHaveAttribute('title', /Ctrl\/Cmd\+S/)
    await expect(page.locator('.save-target')).toHaveText('新片段（未入库）')

    await saveViaToolbar(page)

    // 已保存：按钮改为「已保存」并禁用，胶囊改口说明正在编辑哪一条
    await expect(page.getByRole('button', { name: SAVED_BTN })).toBeDisabled()
    await expect(page.locator('.save-target')).toContainText('正在编辑「curl -sfL')

    // 再改动内容：按钮变「保存修改」，无障碍名称与状态栏都带上条目标题
    await setDoc(page, K3S.replace('YOUR_TOKEN', 'MY_TOKEN'))
    const editButton = page.getByRole('button', { name: /^保存修改到「curl -sfL/ })
    await expect(editButton).toBeEnabled()
    await expect(editButton).toContainText('保存修改')
    await expect(page.locator('.statusbar')).toContainText('编辑「curl -sfL')

    // 从片段库重新载入这条：仍然是「保存修改」的去向，而不是「保存为新片段」
    await saveViaToolbar(page)
    const saved = await openSaved(page)
    await saved.getByRole('button', { name: /在编辑器中打开「curl -sfL/ }).click()
    await expect(page.getByRole('button', { name: SAVED_BTN })).toBeDisabled()
    await expect(page.locator('.save-target')).toContainText('正在编辑「curl -sfL')
  })

  test('未保存标记进标签页标题，保存后恢复干净标题', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/^VimPaste/)

    await setDoc(page, K3S)
    await expect(page).toHaveTitle(/^● VimPaste/)

    await saveViaToolbar(page)
    await expect(page).toHaveTitle(/^VimPaste — /)
  })
})
