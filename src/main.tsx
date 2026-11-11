import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadPrefs } from './storage/prefs'
import './styles/global.css'

// 首帧前应用已保存的主题与字号，避免闪烁
const savedPrefs = loadPrefs()
document.documentElement.dataset.theme = savedPrefs.theme
document.documentElement.style.setProperty('--editor-font-size', `${savedPrefs.fontSize}px`)

// 按设计不注册任何 Service Worker、也不做资源缓存：入口 HTML 每次从网络取，
// 所以永远是最新版本，不需要「发现新版本 / 立即刷新」之类的界面。
// public/sw.js 只是接管旧版本装过的 Workbox SW 的退役脚本，页面不去注册它。

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
