-- 片段备注（可选元信息）：用户给片段写一句「这是做什么的」，列表与详情页展示。
ALTER TABLE "Snippet" ADD COLUMN "note" TEXT;
