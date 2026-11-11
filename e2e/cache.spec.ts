import { expect, test } from '@playwright/test'
import { getDoc } from './helpers'

/**
 * 旧版本用 Workbox 预缓存整个应用，发版后会出现「发现新版本，点击刷新以更新离线缓存」
 * 提示条，用户不点就一直停在旧缓存上。现在按设计完全不做缓存：入口 HTML 每次从网络取，
 * 所以永远是线上最新版本。这组用例守住这个约定：
 *   - 页面不注册任何 Service Worker（注册表为空、也不请求 sw.js）；
 *   - 没有任何 Cache Storage 条目；
 *   - 不再出现「发现新版本」提示条；
 *   - 刷新后照常可用（内容本来就不自动保存，不跨刷新）。
 * 另外确认退役脚本与 manifest 在构建产物里的正确路径可访问。
 */
test.describe('不做离线缓存：每次加载都取最新版本', () => {
  test('不注册 Service Worker、不留缓存，刷新后仍可编辑', async ({ page }) => {
    const swRequests: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.endsWith('/sw.js')) swRequests.push(req.url())
    })

    await page.goto('/')
    await expect(page.locator('.cm-content')).toBeVisible()

    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    )
    expect(registrations).toBe(0)
    // 退役脚本只在「旧 SW 自己做更新检查」时才会被拉取，新用户不会请求它
    expect(swRequests).toEqual([])

    const cacheNames = await page.evaluate(async () => await caches.keys())
    expect(cacheNames).toEqual([])

    await expect(page.getByText('发现新版本')).toHaveCount(0)

    // 刷新=重新走网络拿入口页，页面照常可用
    await page.reload()
    await expect(page.locator('.cm-content')).toBeVisible()
    await page.locator('.cm-content').click()
    await page.keyboard.insertText('echo reload-ok')
    await page.waitForTimeout(200)
    expect(await getDoc(page)).toBe('echo reload-ok')
  })

  test('退役脚本与 manifest 可访问且内容正确', async ({ page, request }) => {
    await page.goto('/')
    // 用页面自己的 URL 拼绝对路径（base 在 Pages 子路径 /vimpaste/ 与 Docker 根路径 / 下都成立）
    const base = page.url()

    const sw = await request.get(new URL('sw.js', base).href)
    expect(sw.status()).toBe(200)
    const swBody = await sw.text()
    // 卸载旧注册 + 清空缓存，且刻意不带 fetch 处理器（不参与请求处理、不可安装）
    expect(swBody).toContain('self.registration.unregister()')
    expect(swBody).toContain('caches.delete')
    expect(swBody).not.toContain("addEventListener('fetch'")

    const manifest = await request.get(new URL('manifest.webmanifest', base).href)
    expect(manifest.status()).toBe(200)
    const json = (await manifest.json()) as { name?: string; start_url?: string }
    expect(json.name).toContain('VimPaste')
    expect(json.start_url).toBe('./')
  })
})
