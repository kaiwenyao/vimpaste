/**
 * Service Worker 退役脚本 —— 不要删这个文件。
 *
 * 旧版本曾用 vite-plugin-pwa（Workbox generateSW + prompt 模式）预缓存整个应用，
 * 并在页面里显示「发现新版本，点击刷新以更新离线缓存」提示条。现在应用按设计
 * 完全不做缓存（见 vite.config.ts 与 src/main.tsx），但已经访问过旧版本的用户
 * 浏览器里还注册着那个 Workbox SW —— 只要它还在，页面就永远由旧缓存提供，
 * 用户看不到新版本。sw.js 与注册时的 URL 相同，所以用这个同名脚本去接管它：
 * 浏览器下次打开页面做更新检查时会拿到本文件，激活后自行卸载并清空缓存。
 *
 * 刻意不做两件事：
 *   1. 不调用 client.navigate()/location.reload()：激活时强制刷新会丢掉编辑器里
 *      还没复制走的内容。当前页面继续跑旧 JS，下一次自然加载即走网络。
 *   2. 不注册 fetch 处理器：本脚本不参与任何请求处理，也不会被判定为可安装 SW。
 */
self.addEventListener('install', () => {
  // prompt 模式下旧 SW 会一直 waiting，这里直接接管，好尽快完成退役。
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister()
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    })(),
  )
})
