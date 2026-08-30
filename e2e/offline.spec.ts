import { expect, test } from '@playwright/test'
import { getDoc } from './helpers'

test.describe('PWA 离线可用', () => {
  test('注册 Service Worker 后断网刷新仍可编辑', async ({ page }) => {
    await page.goto('/')

    // 等待 Service Worker 激活并控制页面
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          void (async () => {
            try {
              const reg = await navigator.serviceWorker.ready
              resolve(!!reg.active)
            } catch {
              resolve(false)
            }
          })()
        }),
      { timeout: 20_000 },
    )
    // reload 一次确保由 SW 控制
    await page.reload()
    await expect(page.locator('.cm-content')).toBeVisible()

    await page.context().setOffline(true)
    await page.reload()
    await expect(page.locator('.cm-content')).toBeVisible()
    await expect(page.getByText('Local only · 未上传')).toBeVisible()

    await page.locator('.cm-content').click()
    await page.keyboard.insertText('echo offline-ok')
    await page.waitForTimeout(200)
    expect(await getDoc(page)).toBe('echo offline-ok')
  })
})
