/**
 * 构建产物检查：确认关键文件存在并打印包体积（原始 / gzip），
 * 超出预算时以非零退出码失败。首屏预算按 gzip 计。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

if (!existsSync(dist)) {
  console.error('dist/ 不存在，请先执行 vite build')
  process.exit(1)
}

// 应用按设计不做离线缓存（不注册 Service Worker）：manifest.webmanifest 与 sw.js
// 都是 public/ 里的静态文件，其中 sw.js 只是接管旧版本 Workbox SW 的退役脚本。
const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'favicon.svg']
for (const f of required) {
  if (!existsSync(path.join(dist, f))) {
    console.error(`构建产物缺少 ${f}`)
    process.exit(1)
  }
}

// 防回归：一旦有人把 PWA 插件（workbox generateSW）加回来，构建产物里会出现
// workbox-*.js 和带 precache 清单的 sw.js，那就会重新出现「发现新版本」提示条。
const workboxRuntime = readdirSync(dist).filter((name) => /^workbox-.*\.js$/.test(name))
if (workboxRuntime.length > 0) {
  console.error(`构建产物出现了 Workbox 运行时（${workboxRuntime.join(', ')}）：应用不该做离线缓存`)
  process.exit(1)
}
const swSource = readFileSync(path.join(dist, 'sw.js'), 'utf8')
if (swSource.includes('precacheAndRoute')) {
  console.error('dist/sw.js 含 precache 清单：sw.js 应只是退役脚本（见 public/sw.js）')
  process.exit(1)
}

const rows = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else if (/\.(js|css|html|png|svg|webmanifest|woff2?)$/.test(name)) {
      const raw = readFileSync(p)
      rows.push({
        file: path.relative(dist, p),
        raw: s.size,
        gzip: gzipSync(raw).length,
      })
    }
  }
}
walk(dist)

rows.sort((a, b) => b.gzip - a.gzip)
let totalGzip = 0
for (const r of rows) {
  totalGzip += r.gzip
  console.log(
    `${r.file.padEnd(48)} raw ${String(r.raw).padStart(9)}  gzip ${String(r.gzip).padStart(8)}`,
  )
}
console.log(`TOTAL (gzip) ${totalGzip} bytes`)

const jsGzip = rows.filter((r) => r.file.endsWith('.js')).reduce((s, r) => s + r.gzip, 0)
const entryGzip = rows
  .filter((r) => r.file.startsWith('assets/') && /index-.*\.js$/.test(r.file))
  .reduce((s, r) => s + r.gzip, 0)

const LIMITS = { totalGzip: 900_000, jsGzip: 700_000, entryGzip: 450_000 }

if (totalGzip > LIMITS.totalGzip || jsGzip > LIMITS.jsGzip || entryGzip > LIMITS.entryGzip) {
  console.error(`包体积超出预算：${JSON.stringify({ totalGzip, jsGzip, entryGzip, LIMITS })}`)
  process.exit(1)
}
console.log('build check: OK')
