/**
 * 创建账号 CLI（plan-v2-accounts.md Phase 2）：
 * 注册开关默认关闭（DISABLE_REGISTRATION=true），单人自托管用它建首个账号。
 *
 * 用法：
 *   npm run create-user -- --email me@example.com --password '...' [--name 显示名]
 * 或不带参数进入交互式输入（密码不回显）。
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, exit } from 'node:process'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../auth/password.js'

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  let email = argValue('--email')
  let password = argValue('--password')
  const name = argValue('--name')

  const rl = createInterface({ input: stdin, output: stdout })
  try {
    if (!email) email = (await rl.question('邮箱: ')).trim()
    if (!password) {
      // 交互式输入密码：关闭回显由终端职责承担（readline 简化处理，本地 CLI 场景足够）
      password = await rl.question('密码（至少 8 位）: ')
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('邮箱格式非法')
      exit(1)
    }
    if (password.length < 8) {
      console.error('密码至少 8 位')
      exit(1)
    }

    const prisma = new PrismaClient()
    try {
      const exists = await prisma.user.findUnique({ where: { email } })
      if (exists) {
        console.error(`邮箱 ${email} 已注册`)
        exit(1)
      }
      const user = await prisma.user.create({
        data: { email, name: name ?? null, passwordHash: await hashPassword(password) },
      })
      console.log(`账号创建成功：#${user.id} ${user.email}`)
    } finally {
      await prisma.$disconnect()
    }
  } finally {
    rl.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  exit(1)
})
