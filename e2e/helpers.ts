/** 与验收样例逐字一致的核心命令 */
export const K3S = [
  "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\",
  '  --server https://10.10.0.11:6443 \\',
  '  --node-ip 10.10.0.12 \\',
  '  --advertise-address 10.10.0.12 \\',
  '  --flannel-iface eth1',
].join('\n')

export const K3S_REPLACED = K3S.replace('YOUR_TOKEN', 'MY_TOKEN')

declare global {
  interface Window {
    __vimpaste?: {
      getDoc(): string
      setDoc(text: string): void
      getSelection(): { anchor: number; head: number; from: number; to: number }
      setSel(pos: number): void
    }
  }
}

import type { Page } from '@playwright/test'

export async function getDoc(page: Page): Promise<string> {
  return page.evaluate(() => window.__vimpaste?.getDoc() ?? '')
}

export async function setDoc(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.__vimpaste?.setDoc(t), text)
}

/** 确定性地把光标放到指定偏移（Normal 模式） */
export async function setSel(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => window.__vimpaste?.setSel(p), pos)
}

export async function getSelection(page: Page) {
  return page.evaluate(() => window.__vimpaste?.getSelection() ?? null)
}
