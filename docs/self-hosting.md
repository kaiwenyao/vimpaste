# VimPaste 自托管指南（v2）

VimPaste 有两种形态，代码同源，由构建开关区分：

| 形态               | 云端开关               | 数据在哪                     | 适合场景                         |
| ------------------ | ---------------------- | ---------------------------- | -------------------------------- |
| **匿名本地版**     | `VITE_CLOUD_ENABLED=false` | 只在浏览器 localStorage      | GitHub Pages 演示、纯本地使用    |
| **自托管登录版**   | `VITE_CLOUD_ENABLED=true`  | 自建 Postgres + 浏览器缓存   | 跨设备同步、个人片段库           |

匿名路径在两种形态下行为完全一致：未登录时内容只留在本机，不上传任何数据。

## 快速起步（docker compose）

```bash
git clone https://github.com/kaiwenyao/vimpaste.git
cd vimpaste
docker compose up -d          # 一把起 postgres:17 + web(nginx) + api(fastify)
```

- Web：<http://localhost:8080>（compose 里 web 服务映射 80 端口，按需调整）
- API 健康检查：`curl http://localhost:3000/api/healthz`
- 本地 compose 默认开放注册（`DISABLE_REGISTRATION=false`），直接在页面右上角「登录 → 注册」创建账号。

> **登录需要 HTTPS（localhost 除外）**：会话 Cookie 带 `Secure` 属性，浏览器只在
> HTTPS 站点（或被视为安全的 `localhost`）保存它。用 `http://<局域网IP>:8080`
> 从其它设备访问时点「登录」会没有任何反应——这是浏览器的安全行为，不是故障。
> 局域网使用请上 TLS（如 nginx/caddy 反代 + 自签或内网证书），或经由 Tailscale
> 等 HTTPS 的组网访问。

## 快速起步（本地开发）

```bash
npm install && npm run dev            # 前端（Vite）
cd server && npm install && npm run dev   # API（tsx watch，需 Postgres）
```

首次运行端到端测试前需要安装浏览器：`npx playwright install chromium`。

## 创建账号（生产：注册默认关闭）

单人自托管建议保持注册关闭，用 CLI 建账号：

```bash
cd server
npm run create-user -- --email me@example.com --password '至少8位'
```

要开放注册（例如家庭多人使用），设置环境变量 `DISABLE_REGISTRATION=false`。

## 环境变量（API）

| 变量                       | 默认    | 说明                                                             |
| -------------------------- | ------- | ---------------------------------------------------------------- |
| `DATABASE_URL`             | —       | 必填，Postgres 连接串                                            |
| `SESSION_SECRET`           | —       | 必填，≥ 32 字节随机值（`openssl rand -base64 32`）               |
| `DISABLE_REGISTRATION`     | `true`  | 关闭注册；单人自托管保持默认                                     |
| `MAX_SNIPPETS_PER_USER`    | `10000` | 单用户条目上限                                                   |
| `MAX_CONTENT_CHARS`        | `100000`| 单条内容上限，与前端常量保持一致                                 |
| `TOMBSTONE_RETENTION_DAYS` | `30`    | 软删除墓碑保留天数                                               |
| `PORT`                     | `3000`  | 监听端口                                                         |
| `TRUST_PROXY`              | `true`  | 信任反向代理的 `X-Forwarded-*`（nginx / k3s ingress 场景保持开启）|

前端构建期变量：

| 变量                  | 默认   | 说明                                                                 |
| --------------------- | ------ | -------------------------------------------------------------------- |
| `VITE_CLOUD_ENABLED`  | `false`| **构建期**开关；Docker 镜像里默认 `true`，GitHub Pages 保持 `false` |

## 数据可靠性：请务必阅读

**服务端不做备份，这是已确认的设计决策，不是遗漏。**

- Postgres 的 PVC 损坏或误删，云端数据就没了。
- 唯一的两条兜底：
  1. 登录后在片段库面板点 **「导出 JSON」**，随时把全部条目导出为本地文件；
  2. 登录用户的浏览器本地仍保留最近 500 条缓存，集群整个挂掉时近期数据还在浏览器里。
- 如果你把 VimPaste 当成唯一存放处，请定期导出 JSON，或自行给 PVC 做快照。

## 同步行为说明

- 登录后：本地编辑 2 秒后自动推送；窗口聚焦、每 5 分钟、断网恢复时同步。
- 离线完全可写：变更暂存本地队列，恢复后自动推送。
- 冲突不覆盖：以服务端为准，你的本地版本另存为「（冲突副本）」条目。
- **「仅本地」** 标记的条目永不离开浏览器；已同步的条目打开此开关会先从服务器删除。
- 敏感内容提醒：服务端**明文**存储片段内容（这是服务端搜索与标题预览的前提），
  真正敏感的条目请开「仅本地」。详见 [privacy.md](privacy.md)。

## 部署到 k3s

参考清单在 [deploy/k3s/](k3s/)（api Deployment/Service、Postgres StatefulSet + PVC、
Secret 模板）。Jenkins 流水线会自动构建并推送 web 与 api 两个镜像到 ghcr，
并在 main 分支构建后更新 k3s-home 的 GitOps 清单。
