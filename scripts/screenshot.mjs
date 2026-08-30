/** 生成 README 截图：桌面与移动视口下的核心使用场景 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const K3S = [
  "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\",
  '  --server https://10.10.0.11:6443 \\',
  '  --node-ip 10.10.0.12 \\',
  '  --advertise-address 10.10.0.12 \\',
  '  --flannel-iface eth1',
].join('\n')

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
mkdirSync(path.join(root, 'docs'), { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:4173/vimpaste/')
await page.evaluate((t) => window.__vimpaste.setDoc(t), K3S)
await page.waitForTimeout(1200)
// 选中占位符，展示 ]v 导航效果
await page.evaluate(() => window.__vimpaste.setSel(0))
await page.keyboard.press(']')
await page.keyboard.press('v')
await page.waitForTimeout(300)
writeFileSync(
  path.join(root, 'docs', 'screenshot-desktop.png'),
  await page.screenshot({ path: undefined }),
)
console.log('desktop screenshot done')

const mobile = await browser.newPage({ viewport: { width: 412, height: 915 } })
await mobile.goto('http://localhost:4173/vimpaste/')
await mobile.evaluate((t) => window.__vimpaste.setDoc(t), K3S)
await mobile.waitForTimeout(1200)
writeFileSync(path.join(root, 'docs', 'screenshot-mobile.png'), await mobile.screenshot())
console.log('mobile screenshot done')

await browser.close()
