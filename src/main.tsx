import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadPrefs } from './storage/prefs'
import './styles/global.css'

// 首帧前应用已保存的主题，避免闪烁
document.documentElement.dataset.theme = loadPrefs().theme

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
