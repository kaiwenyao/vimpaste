import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../../src/utils/clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.textContent = ''
})

function stubClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

describe('copyText', () => {
  it('Clipboard API 可用时逐字复制并返回 clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const text = "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\\n  --x 1"
    await expect(copyText(text)).resolves.toBe('clipboard')
    expect(writeText.mock.calls).toHaveLength(1)
    expect(writeText.mock.calls[0][0]).toBe(text)
  })

  it('Clipboard API 不可用时降级到 execCommand 且内容一致', async () => {
    stubClipboard(undefined)
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec as unknown as typeof document.execCommand
    const text = 'line1\nline2  \ttab'
    await expect(copyText(text)).resolves.toBe('fallback')
    expect(exec).toHaveBeenCalledWith('copy')
    // 降级 textarea 已被移除
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('Clipboard API 抛异常时走降级', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec as unknown as typeof document.execCommand
    await expect(copyText('abc')).resolves.toBe('fallback')
    expect(exec).toHaveBeenCalled()
  })

  it('两条路径都失败时返回 failed', async () => {
    stubClipboard(undefined)
    document.execCommand = vi.fn().mockReturnValue(false) as unknown as typeof document.execCommand
    await expect(copyText('abc')).resolves.toBe('failed')
  })

  it('空内容直接失败（避免无意义提示成功）', async () => {
    stubClipboard(vi.fn())
    await expect(copyText('')).resolves.toBe('failed')
  })
})
