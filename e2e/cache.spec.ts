import { expect, test } from '@playwright/test'
import { getDoc } from './helpers'

/**
 * 旧版本用 Workbox 预缓存整个应用，发版后会出现「发现新版本，点击刷新以更新离线缓存」
 * 提示条，用户不点就一直停在旧缓存上。现在按设计完全不做缓存：入口 HTML 每次从网络取，
 * 所以永远是线上最新版本。这组用例守住这个约定：
 *   - 页面不注册任何 Service Worker（注册表为空、controller 为空、没有创建 SW）；
 *   - 没有任何 Cache Storage 条目；
 *   - 不再出现「发现新版本」提示条；
 *   - 刷新后照常可用（内容本来就不自动保存，不跨刷新）。
 * 另外确认退役脚本与 manifest 在构建产物里的正确路径可访问，并验证退役脚本只清本应用
 * scope 的 Workbox 缓存。
 *
 * 注意：Service Worker 脚本的下载不经过 page 级 request 事件（Playwright 的
 * page.on('request') 看不到），所以不能靠它断言「没有请求 sw.js」；注册表为空才是
 * 真正有效的守护。
 */
test.describe('不做离线缓存：每次加载都取最新版本', () => {
  test('不注册 Service Worker、不留缓存，刷新后仍可编辑', async ({ page }) => {
    // 注册表只能看到「当前仍存在」的注册；再从事件侧确认加载全程没有创建过 SW。
    const createdServiceWorkers: string[] = []
    page.context().on('serviceworker', (worker) => createdServiceWorkers.push(worker.url()))

    await page.goto('/')
    await expect(page.locator('.cm-content')).toBeVisible()

    const swState = await page.evaluate(async () => ({
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    }))
    expect(swState.registrations).toBe(0)
    expect(swState.controller).toBeNull()
    expect(createdServiceWorkers).toEqual([])

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
    // 卸载旧注册 + 只清本应用 scope 的 Workbox 缓存，且刻意不带 fetch 处理器
    expect(swBody).toContain('self.registration.unregister()')
    expect(swBody).toContain('caches.delete')
    expect(swBody).not.toContain("addEventListener('fetch'")

    const manifest = await request.get(new URL('manifest.webmanifest', base).href)
    expect(manifest.status()).toBe(200)
    const json = (await manifest.json()) as { name?: string; start_url?: string }
    expect(json.name).toContain('VimPaste')
    expect(json.start_url).toBe('./')
  })

  test('退役脚本只清本应用 scope 的 Workbox 缓存', async ({ page }) => {
    const createdServiceWorkers: string[] = []
    page.context().on('serviceworker', (worker) => createdServiceWorkers.push(worker.url()))

    await page.goto('/')
    await expect(page.locator('.cm-content')).toBeVisible()

    // 本应用与同 origin 另一个项目的 Workbox 缓存名（Workbox 7 默认命名）
    const scope = new URL('.', page.url()).href
    const ownWorkbox = `workbox-precache-v2-${scope}`
    const otherWorkbox = `workbox-precache-v2-${new URL('/other/', page.url()).href}`
    const otherAppCache = 'some-other-app-cache'
    const seeded = [ownWorkbox, otherWorkbox, otherAppCache]

    await page.evaluate(async (names) => {
      await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name)
          await cache.put('./legacy-asset', new Response('legacy'))
        }),
      )
    }, seeded)
    expect(await page.evaluate(async () => (await caches.keys()).sort())).toEqual(
      [...seeded].sort(),
    )

    await page.evaluate(async (url) => {
      await navigator.serviceWorker.register(url)
    }, new URL('sw.js', scope).href)
    // 确认退役脚本确实被创建并执行过，而不是注册静默失败、缓存本来就不存在
    await expect.poll(() => createdServiceWorkers.length).toBeGreaterThan(0)

    // 退役脚本自我注销，并只清本应用 scope 的 Workbox 缓存；其它缓存保留
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      )
      .toBe(0)
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
      .toEqual([otherWorkbox, otherAppCache].sort())
  })
})
