import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { loadPrefs } from './storage/prefs'
import './styles/global.css'

// 首帧前应用已保存的主题，避免闪烁
document.documentElement.dataset.theme = loadPrefs().theme

// Service Worker（prompt 模式）：新版本就绪时通知 UI 显示提示条，
// 由用户点击「立即刷新」激活，绝不自动重载（避免丢失未复制的编辑内容）。
window.__vimpasteApplyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('vimpaste:update-ready'))
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
