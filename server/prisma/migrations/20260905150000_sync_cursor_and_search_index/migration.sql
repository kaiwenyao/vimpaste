-- 增量拉取游标（plan-v2-accounts.md §7.1 的实现修正）：
-- updatedAt 由客户端时钟提供，「其它设备按 updatedAt > since 拉取」会永久漏单
-- （设备 B 离线修改带旧时间戳、后补推送时已被其它设备的游标越过）。
-- syncedAt 由服务端在每次写入时赋值，专用于下行增量与墓碑传播。
ALTER TABLE "Snippet" ADD COLUMN "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 存量行回填：以最后修改时间作为初始游标
UPDATE "Snippet" SET "syncedAt" = "updatedAt";

CREATE INDEX "Snippet_ownerId_syncedAt_idx" ON "Snippet"("ownerId", "syncedAt");

-- 搜索索引修正：(title || ' ' || content) 的表达式索引无法服务于
-- 「title ILIKE OR content ILIKE」的查询形态，改为两列各建一个 trgm GIN 索引。
DROP INDEX IF EXISTS "snippet_search_idx";
CREATE INDEX IF NOT EXISTS "snippet_title_trgm_idx" ON "Snippet" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "snippet_content_trgm_idx" ON "Snippet" USING GIN ("content" gin_trgm_ops);
