-- 搜索索引（plan-v2-accounts.md §5.2）：
-- pg_trgm 的 GIN 索引让 ILIKE '%kw%' 走索引扫描，中英文关键词都能命中。
-- 个人量级（万条以内）毫秒级；将来需要更复杂的检索再上 tsvector/外部引擎，接口不变。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 手写表达式索引：Prisma schema 无法表达 gin_trgm_ops，故放在独立迁移中
CREATE INDEX IF NOT EXISTS snippet_search_idx
  ON "Snippet"
  USING GIN ((title || ' ' || content) gin_trgm_ops);
