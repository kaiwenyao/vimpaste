/**
 * 极简 hash 路由：#/（编辑器）、#/saved（片段库）、#/saved/:id（条目详情）。
 * 用 hash 而不是 History API：GitHub Pages 子路径部署无需服务端重写，
 * 浏览器的前进/后退键天然可用。编辑器内容不写入路由，只表达视图位置。
 */
import { useEffect, useState } from 'react'

export type Route =
  | { view: 'editor' }
  | { view: 'saved' }
  | { view: 'detail'; id: string }

export const SAVED_PATH = '/saved'

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  if (path.startsWith(`${SAVED_PATH}/`)) {
    const id = decodeURIComponent(path.slice(SAVED_PATH.length + 1))
    if (id !== '') return { view: 'detail', id }
  }
  if (path === SAVED_PATH) return { view: 'saved' }
  return { view: 'editor' }
}

/** 编程式导航：设置 hash 后由 hashchange 驱动视图切换 */
export function navigate(path: string): void {
  window.location.hash = path
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
