# =============================================================================
# VimPaste 容器镜像
# =============================================================================
# 多阶段构建：
#   阶段一（node）—— 安装依赖并执行完整构建（tsc + vite build + 体积预算检查）
#   阶段二（nginx）—— 只拷贝 dist 静态产物，由 nginx 托管 SPA
#
# 注意：项目默认按 GitHub Pages 子路径构建（vite.config.ts 里 base=/vimpaste/），
# 而容器由 nginx 对根路径托管，因此这里用 vite build --base=/ 覆写 base，
# 其余步骤与 npm run build 完全一致（含 scripts/check-build.mjs 的体积预算检查）。
# =============================================================================

# ---------- 阶段一：构建 ----------
FROM node:24-alpine AS build
WORKDIR /app

# 先只拷贝 lockfile 安装依赖，充分利用 Docker 层缓存：
# 源码改动不会触发 node_modules 重新下载
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc -b && npx vite build --base=/ && node scripts/check-build.mjs

# ---------- 阶段二：运行 ----------
FROM nginx:1.29-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
