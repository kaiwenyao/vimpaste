import { expect, test } from '@playwright/test'
import { K3S, K3S_REPLACED, getDoc, getSelection, setDoc, setSel } from './helpers'

test.describe('K3s 核心验收流程', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('真实粘贴 → 识别 → ]v 替换 → 复制逐字一致 → 刷新清空 → 无外发请求', async ({ page }) => {
    const external: string[] = []
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname
      if (host !== 'localhost' && host !== '127.0.0.1') external.push(req.url())
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') throw new Error(`console error: ${msg.text()}`)
    })

    await page.goto('/')

    // 通过真实剪贴板粘贴 K3s 命令
    await page.evaluate((t) => navigator.clipboard.writeText(t), K3S)
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+v')
    await page.keyboard.press('Escape') // 粘贴后回到 Normal 模式
    await setSel(page, 0)

    // 1. 自动识别为 Shell / Bash
    await expect(page.getByRole('combobox', { name: '语言' })).toHaveValue('shell', {
      timeout: 5000,
    })
    await expect(page.locator('.statusbar')).toContainText('Shell / Bash')

    // 2. YOUR_TOKEN 被标记，计数为 1
    await expect(page.getByText('1 个待替换')).toBeVisible()
    const deco = page.locator('.cm-vp-placeholder').filter({ hasText: 'YOUR_TOKEN' })
    await expect(deco).toHaveCount(1)

    // 3. ]v 定位到占位符（选中 YOUR_TOKEN）；按 c 直接更改选区并输入替换文本
    await page.keyboard.press(']')
    await page.keyboard.press('v')
    const sel = await getSelection(page)
    const docBefore = await getDoc(page)
    expect(docBefore.slice(sel.anchor, sel.head)).toBe('YOUR_TOKEN')

    await page.keyboard.press('c')
    await page.keyboard.insertText('MY_TOKEN')
    await page.keyboard.press('Escape')

    // 4. 多行结构、缩进、引号、反斜杠逐字不变
    expect(await getDoc(page)).toBe(K3S_REPLACED)

    // 5. 一键复制与编辑器内容逐字一致
    await page.getByRole('button', { name: '复制' }).click()
    await expect(page.getByRole('status')).toHaveText('已复制到剪贴板')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(K3S_REPLACED)

    // 6. 刷新后编辑器从空白开始（历史面板中的条目按功能保留在本浏览器）
    await page.reload()
    expect(await getDoc(page)).toBe('')
    await expect(page.getByText('0 个待替换')).toBeVisible()

    // 7. 全程无外发网络请求
    expect(external).toEqual([])
  })

  test('环境变量赋值的占位值（export API_KEY="你的 API Key"）识别、跳转与替换', async ({
    page,
  }) => {
    const DOC = [
      'export API_KEY="你的 API Key"',
      'export BASE_URL="https://api.deepseek.com"',
      'python chatbot.py',
    ].join('\n')
    await page.goto('/')
    await setDoc(page, DOC)
    await setSel(page, 0)

    // 1. 占位值被标记（真实值 BASE_URL 不标记），计数为 1
    await expect(page.getByText('1 个待替换')).toBeVisible()
    const deco = page.locator('.cm-vp-placeholder').filter({ hasText: '你的 API Key' })
    await expect(deco).toHaveCount(1)

    // 2. ]v 选中值本身，按 c 输入真实值完成替换
    await page.keyboard.press(']')
    await page.keyboard.press('v')
    const sel = await getSelection(page)
    expect(DOC.slice(sel.anchor, sel.head)).toBe('你的 API Key')

    await page.keyboard.press('c')
    await page.keyboard.insertText('sk-real-key')
    await page.keyboard.press('Escape')

    // 3. 其余内容（引号、BASE_URL、命令行）逐字不变
    expect(await getDoc(page)).toBe(DOC.replace('你的 API Key', 'sk-real-key'))
    await expect(page.getByText('0 个待替换')).toBeVisible()
  })

  test('状态栏光标与字符数随内容更新', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)
    const status = page.locator('.statusbar')
    await expect(status).toContainText(`${K3S.length} 字符`)
    await expect(status).toContainText('行 1，列 1')
  })
})

test.describe('Vim 常用操作验证', () => {
  const DOC = 'alpha beta gamma\ndelta epsilon\nzeta\n'
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await setDoc(page, DOC)
    await setSel(page, 0)
  })

  test('移动：w 0 $ gg G f', async ({ page }) => {
    const head = async () => (await getSelection(page)).head
    // w
    await page.keyboard.press('w')
    expect(await head()).toBe(6)
    await page.keyboard.press('w')
    expect(await head()).toBe(11)
    // 0 与 $
    await page.keyboard.press('0')
    expect(await head()).toBe(0)
    await page.keyboard.press('$')
    expect(await head()).toBe(15)
    // gg / G
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    expect(await head()).toBe(0)
    await page.keyboard.press('G')
    // 文档以换行结尾，G 落在最后一个空行的行首
    expect(await head()).toBe(DOC.length)
    // G 后上移两行到 "delta epsilon" 行测试 f{char}
    await page.keyboard.press('k')
    await page.keyboard.press('k')
    await page.keyboard.press('0')
    await page.keyboard.press('f')
    await page.keyboard.press('p')
    // "delta epsilon" 行中 f p → epsilon 的 p
    expect(await head()).toBe(DOC.indexOf('epsilon') + 1)
  })

  test('插入与编辑：i a o x r dd u Ctrl-r yy p cw', async ({ page }) => {
    // i：光标处插入
    await page.keyboard.press('i')
    await page.keyboard.insertText('X')
    await page.keyboard.press('Escape')
    expect(await getDoc(page)).toBe('Xalpha beta gamma\ndelta epsilon\nzeta\n')
    // a：光标后插入
    await setSel(page, 0)
    await page.keyboard.press('a')
    await page.keyboard.insertText('Y')
    await page.keyboard.press('Escape')
    expect(await getDoc(page)).toBe('XYalpha beta gamma\ndelta epsilon\nzeta\n')
    // x：删除光标处字符（光标位置不变，后续字符前移）
    await setSel(page, 1)
    await page.keyboard.press('x')
    expect(await getDoc(page)).toBe('Xalpha beta gamma\ndelta epsilon\nzeta\n')
    // r：替换光标处字符
    await setSel(page, 0)
    await page.keyboard.press('r')
    await page.keyboard.press('A')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\ndelta epsilon\nzeta\n')
    // o：下方新建一行插入
    await setSel(page, 0)
    await page.keyboard.press('o')
    await page.keyboard.insertText('new line')
    await page.keyboard.press('Escape')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\nnew line\ndelta epsilon\nzeta\n')
    // dd 删除第 2 行
    await page.keyboard.press('Escape')
    await setSel(page, 'Aalpha beta gamma\n'.length)
    await page.keyboard.press('d')
    await page.keyboard.press('d')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\ndelta epsilon\nzeta\n')
    // u 撤销（恢复整行）→ Ctrl-r 重做 → u 再撤销
    await page.keyboard.press('u')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\nnew line\ndelta epsilon\nzeta\n')
    await page.keyboard.press('Control+r')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\ndelta epsilon\nzeta\n')
    await page.keyboard.press('u')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\nnew line\ndelta epsilon\nzeta\n')
    // yy + p：复制当前行并粘贴到下方
    await page.keyboard.press('Escape')
    await setSel(page, 'Aalpha beta gamma\n'.length)
    await page.keyboard.press('y')
    await page.keyboard.press('y')
    await page.keyboard.press('p')
    expect(await getDoc(page)).toBe('Aalpha beta gamma\nnew line\nnew line\ndelta epsilon\nzeta\n')
    // cw：修改光标所在单词
    await page.keyboard.press('Escape')
    await setSel(page, 0)
    await page.keyboard.press('c')
    await page.keyboard.press('w')
    await page.keyboard.insertText('First')
    await page.keyboard.press('Escape')
    expect(await getDoc(page)).toBe('First beta gamma\nnew line\nnew line\ndelta epsilon\nzeta\n')
  })

  test('搜索：/ 与 n', async ({ page }) => {
    await page.keyboard.press('/')
    await page.keyboard.insertText('epsilon')
    await page.keyboard.press('Enter')
    expect((await getSelection(page)).head).toBe(DOC.indexOf('epsilon'))
    // n：搜索下一个（循环回到自身）
    await page.keyboard.press('n')
    expect((await getSelection(page)).head).toBe(DOC.indexOf('epsilon'))
  })

  test('可视模式与文本对象', async ({ page }) => {
    // viw 选中单词
    await page.keyboard.press('v')
    await page.keyboard.press('i')
    await page.keyboard.press('w')
    const sel = await getSelection(page)
    expect(DOC.slice(sel.anchor, sel.head)).toBe('alpha')
    // d 删除选区
    await page.keyboard.press('d')
    expect(await getDoc(page)).toBe(' beta gamma\ndelta epsilon\nzeta\n')
  })
})

test.describe('Vim 偏好与清空', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('键位偏好持久化（设置面板），内容刷新消失；清空需确认', async ({ page }) => {
    await page.goto('/')
    await setDoc(page, K3S)

    // 切到普通编辑器模式 → 刷新后仍保留
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('radio', { name: /普通编辑器/ }).click()
    await page.getByRole('button', { name: '关闭设置' }).click()
    await page.reload()
    await expect(page.locator('.mode-badge')).toHaveText('—')
    expect(await getDoc(page)).toBe('')

    // 切回 Vim
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('radio', { name: /^Vim/ }).click()
    await page.getByRole('button', { name: '关闭设置' }).click()
    await page.reload()
    await expect(page.locator('.mode-badge')).toHaveText('NORMAL')

    // 清空确认流程
    await setDoc(page, K3S)
    await page.getByRole('button', { name: '清空编辑器' }).click()
    await expect(page.getByRole('button', { name: '确认清空全部内容' })).toBeVisible()
    expect(await getDoc(page)).toBe(K3S)
    await page.getByRole('button', { name: '确认清空全部内容' }).click()
    expect(await getDoc(page)).toBe('')
  })
})
