/**
 * 回收站端到端（未登录 / 本地路径）。
 *
 * 覆盖用户真正在意的三件事：
 *   1. 删除后条目不再立刻消失——它去回收站了，刷新页面还在；
 *   2. 能恢复（回到片段库）也能彻底删除（真的没了）；
 *   3. 保留期与到期清除是可见、可解释的（「剩余 N 天」+ 打开即清理过期墓碑）。
 */
import { expect, test, type Page } from '@playwright/test'
import { K3S, setDoc } from './helpers'

const ITEM = /^curl -sfL https/
const HISTORY_KEY = 'vimpaste.history.v1'
const DAY = 24 * 60 * 60 * 1000

async function openSaved(page: Page) {
  await page.getByRole('button', { name: '已保存片段' }).click()
  await expect(page.locator('.saved-page')).toBeVisible()
  return page.locator('.saved-page')
}

/** 从回收站/详情页回到片段库时已经在页面上，不需要再点工具栏按钮 */
async function currentSavedPage(page: Page) {
  await expect(page.locator('.saved-page')).toBeVisible()
  return page.locator('.saved-page')
}

/** 等语言识别完成后手动保存（保存按钮仅在确有未保存修改时可用） */
async function saveViaToolbar(page: Page) {
  await expect(page.getByRole('button', { name: '保存到片段库' })).toBeEnabled()
  await page.getByRole('button', { name: '保存到片段库' }).click()
  await expect(page.getByRole('status')).toHaveText('已保存到片段库')
}

/** 存一条 K3S 片段，然后在片段库里把它删除（进回收站） */
async function saveAndDelete(page: Page) {
  await page.goto('/')
  await setDoc(page, K3S)
  await saveViaToolbar(page)
  const saved = await openSaved(page)
  await saved.getByRole('button', { name: /删除「curl -sfL/ }).click()
  await expect(saved.getByText('还没有保存过任何内容')).toBeVisible()
}

function stored(page: Page) {
  return page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) ?? '[]') as { deletedAt: number | null }[],
    HISTORY_KEY,
  )
}

test.describe('回收站（本地路径）', () => {
  test('删除进回收站：内容仍在本地存储里，刷新后回收站仍能看到并可恢复', async ({ page }) => {
    await saveAndDelete(page)

    // 删除不等于抹掉：内容仍在存储里，带 deletedAt 墓碑
    const rows = await stored(page)
    expect(rows).toHaveLength(1)
    expect(rows[0].deletedAt).not.toBeNull()

    // 从片段库页脚进入回收站：能看到刚删的条目与剩余天数
    await page.getByRole('button', { name: '回收站（1 条）' }).click()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^恢复「curl -sfL/ })).toBeVisible()
    await expect(page.getByText(/剩余 30 天/)).toBeVisible()
    await expect(page.getByText(/保留 30 天/)).toBeVisible()
    // 按删除时间分组列出
    await expect(page.locator('.trash-page .history-group')).toContainText('今天删除')

    // 刷新（#/trash 直达）：仍在回收站页面，条目还在
    await page.reload()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^恢复「curl -sfL/ })).toBeVisible()

    // 恢复 → 回到片段库；回收站清空
    await page.getByRole('button', { name: /^恢复「curl -sfL/ }).click()
    await expect(page.getByText('回收站是空的')).toBeVisible()
    const restored = await stored(page)
    expect(restored).toHaveLength(1)
    expect(restored[0].deletedAt).toBeNull()

    await page.getByRole('button', { name: '返回片段库' }).click()
    const saved = await currentSavedPage(page)
    await expect(saved.getByRole('button', { name: ITEM })).toBeVisible()
  })

  test('浏览器后退键可用：#/trash ↔ #/saved 之间往返', async ({ page }) => {
    await saveAndDelete(page)

    await page.getByRole('button', { name: '回收站（1 条）' }).click()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: '已保存' })).toBeVisible()

    await page.goForward()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^恢复「curl -sfL/ })).toBeVisible()
  })

  test('彻底删除：单条与清空回收站都真的要二次确认，之后存储里再无痕迹', async ({ page }) => {
    await saveAndDelete(page)
    await page.getByRole('button', { name: '回收站（1 条）' }).click()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()

    // 单条彻底删除：第一次点击只是进入确认态，第二次才真的删
    await page.getByRole('button', { name: /^彻底删除「curl -sfL/ }).click()
    await expect(page.getByRole('button', { name: /^确认彻底删除「curl -sfL/ })).toBeVisible()
    expect(await stored(page)).toHaveLength(1)
    await page.getByRole('button', { name: /^确认彻底删除「curl -sfL/ }).click()
    await expect(page.getByText('回收站是空的')).toBeVisible()
    expect(await stored(page)).toHaveLength(0)

    // 再来一条，用「清空回收站」：第一次点击只是进入确认态
    await saveAndDelete(page)
    await page.getByRole('button', { name: '回收站（1 条）' }).click()
    await page.getByRole('button', { name: '清空回收站' }).click()
    await expect(page.getByRole('button', { name: '确认清空回收站' })).toBeVisible()
    expect(await stored(page)).toHaveLength(1)

    await page.getByRole('button', { name: '确认清空回收站' }).click()
    await expect(page.getByText('回收站是空的')).toBeVisible()
    expect(await stored(page)).toHaveLength(0)
  })

  test('「清空全部片段」把条目送进回收站，可整批恢复', async ({ page }) => {
    await page.goto('/')
    // 两次入库之间用「清空编辑器」断开与当前条目的关联，否则第二次保存是更新同一条
    await setDoc(page, K3S)
    await saveViaToolbar(page)
    await page.getByRole('button', { name: '清空编辑器' }).click()
    await page.getByRole('button', { name: '确认清空全部内容' }).click()
    await setDoc(page, 'docker run -d -p 80:80 nginx')
    await saveViaToolbar(page)

    const saved = await openSaved(page)
    await expect(saved.locator('.history-row')).toHaveCount(2)
    await saved.getByRole('button', { name: '清空全部片段（可在回收站恢复）' }).click()
    await saved.getByRole('button', { name: '确认清空全部片段（可在回收站恢复）' }).click()
    await expect(saved.getByText('还没有保存过任何内容')).toBeVisible()

    // 两条都进了回收站，不是被抹掉
    await page.getByRole('button', { name: '回收站（2 条）' }).click()
    await expect(page.locator('.trash-row')).toHaveCount(2)

    const restoreButtons = page.getByRole('button', { name: /^恢复「/ })
    await restoreButtons.first().click()
    await expect(page.locator('.trash-row')).toHaveCount(1)
    const remaining = await stored(page)
    expect(remaining.filter((s) => s.deletedAt === null)).toHaveLength(1)
  })

  test('超过 30 天的墓碑：打开应用即清除，回收站与存储里都不再出现', async ({ page }) => {
    // 先造两条墓碑：一条刚删、一条 31 天前删的
    await page.goto('/')
    await page.evaluate(
      ({ key, day }) => {
        const now = Date.now()
        localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: 'fresh',
              title: '今天删的',
              content: 'echo fresh',
              langId: 'shell',
              createdAt: 1,
              updatedAt: 2,
              deletedAt: now - 1000,
            },
            {
              id: 'expired',
              title: '31 天前删的',
              content: 'echo old',
              langId: 'shell',
              createdAt: 3,
              updatedAt: 4,
              deletedAt: now - 31 * day,
            },
          ]),
        )
      },
      { key: HISTORY_KEY, day: DAY },
    )

    await page.reload()
    await page.evaluate(() => {
      window.location.hash = '/trash'
    })
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()

    // 到期的没了，没到期的还在
    await expect(page.getByText('今天删的')).toBeVisible()
    await expect(page.getByText('31 天前删的')).toHaveCount(0)

    // 而且是真的从存储里清掉了（不是只隐藏）
    await expect
      .poll(async () =>
        page.evaluate((k) => {
          const rows = JSON.parse(localStorage.getItem(k) ?? '[]') as { id: string }[]
          return rows.map((r) => r.id).join(',')
        }, HISTORY_KEY),
      )
      .toBe('fresh')
  })

  test('收藏夹删除不进回收站（收藏夹不是片段）', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    await saveViaToolbar(page)

    // 未登录没有收藏夹面板：回收站入口仍然可用，且此时应为空
    const saved = await openSaved(page)
    await expect(saved.getByRole('button', { name: '回收站（空）' })).toBeVisible()
    await saved.getByRole('button', { name: '回收站（空）' }).click()
    await expect(page.getByText('回收站是空的')).toBeVisible()

    // 片段仍在库里（回收站为空 ≠ 片段没了）
    await page.getByRole('button', { name: '返回片段库' }).click()
    const back = await currentSavedPage(page)
    await expect(back.getByRole('button', { name: ITEM })).toBeVisible()
  })
})
