import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { LangId } from '../detection/language'

/**
 * CodeMirror 语言扩展按需动态加载：
 * 语言包只在首次用到时下载，不进入首屏包。
 */
async function importLanguage(id: LangId): Promise<Extension | null> {
  switch (id) {
    case 'shell': {
      const m = await import('@codemirror/legacy-modes/mode/shell')
      return StreamLanguage.define(m.shell)
    }
    case 'powershell': {
      const m = await import('@codemirror/legacy-modes/mode/powershell')
      return StreamLanguage.define(m.powerShell)
    }
    case 'dockerfile': {
      const m = await import('@codemirror/legacy-modes/mode/dockerfile')
      return StreamLanguage.define(m.dockerFile)
    }
    case 'nginx': {
      const m = await import('@codemirror/legacy-modes/mode/nginx')
      return StreamLanguage.define(m.nginx)
    }
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript()
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    default:
      return null
  }
}

const cache = new Map<LangId, Promise<Extension | null>>()

export function loadCmLanguage(id: LangId): Promise<Extension | null> {
  let p = cache.get(id)
  if (!p) {
    p = importLanguage(id).catch(() => null)
    cache.set(id, p)
  }
  return p
}
