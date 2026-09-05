/**
 * seed 脚本（plan-v2-accounts.md Phase 1）：本地开发用的演示数据。
 * 用法：cd server && npx prisma db seed（prisma.config.ts 未配置时可用 tsx 直接跑）
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/auth/password.js'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const email = process.env.SEED_EMAIL ?? 'demo@vimpaste.local'
  const password = process.env.SEED_PASSWORD ?? 'vimpaste-demo'
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Demo',
      passwordHash: await hashPassword(password),
    },
  })

  const now = Date.now()
  const demoCollection = await prisma.collection.upsert({
    where: { name_ownerId: { name: '运维常用', ownerId: user.id } },
    update: {},
    create: { name: '运维常用', ownerId: user.id, order: 0 },
  })

  await prisma.snippet.upsert({
    where: { id: '0f0e7d2e-1111-4c5a-9a2e-demo0000001' },
    update: {},
    create: {
      id: '0f0e7d2e-1111-4c5a-9a2e-demo0000001',
      ownerId: user.id,
      kind: 'command',
      title: "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -",
      content:
        "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\\n  --server https://10.10.0.11:6443 \\\n  --node-ip 10.10.0.12",
      langId: 'shell',
      collectionId: demoCollection.id,
      createdAt: new Date(now - 86_400_000),
      updatedAt: new Date(now - 3_600_000),
    },
  })
  await prisma.snippet.upsert({
    where: { id: '0f0e7d2e-2222-4c5a-9a2e-demo0000002' },
    update: {},
    create: {
      id: '0f0e7d2e-2222-4c5a-9a2e-demo0000002',
      ownerId: user.id,
      kind: 'prompt',
      title: '代码评审 Prompt',
      content: '请审查下面的 {{语言}} 代码，关注边界条件与安全问题，用中文输出：\n\n{{代码}}',
      langId: 'plaintext',
      pinned: true,
      createdAt: new Date(now - 2 * 86_400_000),
      updatedAt: new Date(now - 7_200_000),
    },
  })
  console.log(`seed 完成：${email} / ${password}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
