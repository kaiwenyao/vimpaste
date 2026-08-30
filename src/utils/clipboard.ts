/**
 * 复制到剪贴板：优先 Clipboard API，不可用时降级到隐藏 textarea + execCommand。
 * 返回实际使用的通道，供 UI 区分提示文案。
 */

export type CopyChannel = 'clipboard' | 'fallback' | 'failed'

export async function copyText(text: string): Promise<CopyChannel> {
  if (text.length === 0) return 'failed'
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'clipboard'
    }
  } catch {
    /* 权限被拒或 API 异常，走降级路径 */
  }
  return copyViaExecCommand(text) ? 'fallback' : 'failed'
}

function copyViaExecCommand(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}
