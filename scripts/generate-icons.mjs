/**
 * 生成 PWA 图标：用 Playwright 将内联 SVG 渲染为 PNG。
 * 运行：npm run icons（需要先 npx playwright install chromium）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'public')
mkdirSync(path.join(outDir, 'icons'), { recursive: true })

function svg(size, pad) {
  const r = size * 0.18
  const fs = size * 0.34
  const x = size * pad
  const y = size * (pad + 0.3)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0b0e12"/>
  <rect x="${size * 0.03}" y="${size * 0.03}" width="${size * 0.94}" height="${size * 0.94}" rx="${r * 0.92}" fill="none" stroke="#232c37" stroke-width="${size * 0.03}"/>
  <text x="${x}" y="${y}" font-family="Menlo, Consolas, 'Courier New', monospace" font-size="${fs}" font-weight="bold" fill="#4cc2a9">&gt;_</text>
</svg>`
}

const browser = await chromium.launch()
const page = await browser.newPage()

async function render(name, size, pad) {
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0}</style><div id="i">${svg(size, pad)}</div>`,
  )
  const el = page.locator('#i svg')
  const buf = await el.screenshot({ omitBackground: true })
  writeFileSync(path.join(outDir, name), buf)
  console.log(`generated ${name} (${buf.length} bytes)`)
}

await render('icons/icon-512.png', 512, 0.17)
await render('icons/icon-192.png', 192, 0.17)
await render('icons/maskable-512.png', 512, 0.28)
await render('apple-touch-icon.png', 180, 0.2)

await browser.close()
console.log('icons done')
