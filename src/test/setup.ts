import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// CodeMirror 6 在 jsdom 下需要的最小布局桩
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub
}

Element.prototype.scrollIntoView =
  Element.prototype.scrollIntoView ??
  (() => {
    /* jsdom 无布局，忽略 */
  })

// Range 几何 API：jsdom 未实现，返回空几何即可
const rangeProto = Range.prototype as unknown as Record<string, unknown>
rangeProto.getClientRects ??= () => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
})
rangeProto.getBoundingClientRect ??= () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect

window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList) as never
