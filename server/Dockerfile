# =============================================================================
# VimPaste API 容器镜像（v2，plan-v2-accounts.md Phase 7）
# =============================================================================
# 多阶段构建，与根目录前端 Dockerfile 同风格：
#   build —— 安装依赖、生成 Prisma client、tsc 编译
#   deps  —— 仅生产依赖（另从 build 拷入 prisma CLI 供启动时执行迁移）
#   run   —— 产物 + 依赖；启动命令先 prisma migrate deploy 再起服务
#
# 迁移幂等（migrate deploy 只应用未执行过的），副本多实例同时启动时由
# Postgres 的迁移锁保证只执行一次。
# =============================================================================

# ---------- 阶段一：构建 ----------
FROM node:24-alpine AS build
WORKDIR /app

# 先只拷贝 lockfile 安装依赖，充分利用 Docker 层缓存
COPY server/package.json server/package-lock.json* ./
RUN npm ci

COPY server/ ./
# prisma generate 只读 schema、不连接数据库
RUN npx prisma generate && npx tsc -b

# ---------- 阶段二：生产依赖 ----------
FROM node:24-alpine AS deps
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev
# prisma CLI 属 devDependencies，但启动命令需要它执行 migrate deploy：
# 从 build 阶段原样拷入（含引擎二进制）
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines

# ---------- 阶段三：运行 ----------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# prisma CLI 不在 .bin（deps 阶段未装它），直接以 node 调用其入口；
# exec 保证 node 收到 SIGTERM 能优雅退出
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/index.js"]
