/**
 * Service Worker 退役脚本 —— 不要删这个文件。
 *
 * 旧版本曾用 vite-plugin-pwa（Workbox generateSW + prompt 模式）预缓存整个应用，
 * 并在页面里显示「发现新版本，点击刷新以更新离线缓存」提示条。现在应用按设计
 * 完全不做缓存（见 vite.config.ts 与 src/main.tsx），但已经访问过旧版本的用户
 * 浏览器里还注册着那个 Workbox SW —— 只要它还在，页面就永远由旧缓存提供，
 * 用户看不到新版本。sw.js 与注册时的 URL 相同，所以用这个同名脚本去接管它：
 * 浏览器下次打开页面做更新检查时会拿到本文件，激活后自行卸载，并清理本应用
 * scope 下的 Workbox 缓存。
 *
 * 刻意不做两件事：
 *   1. 不调用 client.navigate()/location.reload()：激活时强制刷新会丢掉编辑器里
 *      还没复制走的内容。当前页面继续跑旧 JS，下一次自然加载即走网络。
 *   2. 不注册 fetch 处理器：本脚本不参与任何请求处理，也不会被判定为可安装 SW。
 *
 * 已知代价（刻意接受）：本脚本 skipWaiting 接管后，当前页仍在跑旧 JS，而新 SW
 * 不处理请求 —— 旧页之后再按需 import() 尚未加载过的语言包时，请求不再由旧
 * Workbox 缓存应答；旧 hash 的 chunk 也已从新部署中消失，未命中 HTTP 缓存时
 * 就是 404。cmLanguage.ts 的 .catch(() => null) 兜住，不崩、不丢文本，只是语法
 * 高亮静默失效到下次刷新。把清缓存延后并不能可靠避免这一点（请求不再经过旧 SW
 * 的 fetch 处理器）；要保住旧页的 chunk 就得保留旧 SW，但那样用户会被一直钉在
 * 旧版本上，代价更大。
 */
self.addEventListener('install', () => {
  // prompt 模式下旧 SW 会一直 waiting，这里直接接管，好尽快完成退役。
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 同一 origin 可能还住着别的项目（GitHub Pages 的 kaiwenyao.github.io
      // 是用户站点根），只清本应用 scope 下由 Workbox 生成的缓存，别碰别人的。
      // Workbox 的缓存名是 workbox-precache-v2-<registration.scope>。
      const scope = self.registration.scope
      await self.registration.unregister()
      const keys = (await caches.keys()).filter(
        (key) => key.startsWith('workbox-') && key.endsWith(scope),
      )
      await Promise.all(keys.map((key) => caches.delete(key)))
    })(),
  )
})
