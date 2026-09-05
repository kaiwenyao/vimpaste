/**
 * 标签 find-or-create：同步与 CRUD 共用。
 * Tag 按 (name, ownerId) 唯一（借鉴 Linkwarden），多人标签名互不干扰。
 */
import type { PrismaClient, Tag } from '@prisma/client'

export async function connectTags(
  prisma: PrismaClient,
  ownerId: number,
  names: string[],
  snippetId: string,
): Promise<void> {
  const unique = [...new Set(names)]
  const tags: Tag[] = []
  for (const name of unique) {
    const tag = await prisma.tag.upsert({
      where: { name_ownerId: { name, ownerId } },
      create: { name, ownerId },
      update: {},
    })
    tags.push(tag)
  }
  await prisma.snippet.update({
    where: { id: snippetId },
    data: { tags: { set: tags.map((t) => ({ id: t.id })) } },
  })
}
