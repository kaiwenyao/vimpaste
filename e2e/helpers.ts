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
import { expect } from '@playwright/test'

/**
 * 保存按钮的无障碍名称随去向变化：新片段 =「保存为新片段」，编辑中 =「保存修改到「<标题>」」，
 * 已保存 = 「当前内容已保存到片段库」。用它定位「这次保存会发生什么」的那个按钮。
 */
export const SAVE_BTN = /^保存(为新片段|修改)/
export const SAVED_BTN = /当前内容已保存到片段库/
/** 保存后的 toast 也跟去向走：新片段=「已保存为新片段」，编辑中=「已保存修改到当前片段」 */
export const SAVE_TOAST = /^已保存(为新片段|修改到当前片段)$/

/** 点保存：先等它由「已保存」回到可操作，再点（避免落在禁用按钮上被静默吞掉） */
export async function saveViaToolbar(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: SAVE_BTN })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.getByRole('status')).toHaveText(SAVE_TOAST)
}

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
