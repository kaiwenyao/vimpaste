import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'VimPaste — 支持 Vim 的临时代码编辑器',
        short_name: 'VimPaste',
        description:
          '为 AI 生成命令准备的、支持 Vim 的临时代码编辑器。所有内容仅在浏览器本地处理。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0b0e12',
        theme_color: '#0b0e12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
    ...(command === 'build' ? [cspMetaPlugin()] : []),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: false,
  },
}))
