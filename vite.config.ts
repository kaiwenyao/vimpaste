import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * 仅在生产构建注入 CSP（dev 模式依赖 HMR 内联脚本，注入会破坏开发体验）。
 * 静态托管（GitHub Pages）无法自定义响应头，meta CSP 是等效部署配置；
 * CodeMirror 大量使用内联 style 属性，因此 style-src 需要 'unsafe-inline'。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

function cspMetaPlugin() {
  return {
    name: 'vimpaste:csp-meta',
    transformIndexHtml(html: string) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vimpaste/' : '/',
  // 按设计不装 Service Worker、不做任何资源缓存：入口 HTML 每次从网络取
  // （nginx 对 index.html 设 no-cache，产物名带内容哈希），因此永远是线上最新版本，
  // 也就不存在「发现新版本」这类状态。public/sw.js 只是给旧版本装过的 SW 用的退役脚本。
  plugins: [react(), ...(command === 'build' ? [cspMetaPlugin()] : [])],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: false,
  },
}))
