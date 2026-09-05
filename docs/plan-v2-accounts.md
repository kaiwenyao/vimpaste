# VimPaste v2 开发计划：账号、云端持久化与「命令 / Prompt」双类型库

> 状态：已实施（Phase 0–8 随 v2 PR 落地）。本文档是 v2 的唯一计划来源，v1 方案见 [PROJECT_PLAN.md](../PROJECT_PLAN.md)。
>
> 实施说明（与原方案的差异，均为兼容性取舍）：
>
> - **本地存储键**：匿名路径沿用 `vimpaste.history.v1` 键与 30 条上限（行为与 v1 逐字节一致，
>   保住「现有测试一行不改地全绿」的硬门槛）；`vimpaste.snippets.v2`（500 条）作为**登录后**
>   的本地缓存键，登录时执行 v1→v2 迁移并保留 v1 键一个版本的回滚窗口。
> - **面板新建入口**：保留「新建粘贴」按钮（可访问名被既有单测锁定），在其下新增「新建 Prompt」按钮。
> - **同步范围**：`/api/snippets/sync` 只同步片段（含 tags/collectionId）；集合与标签通过各自
>   端点按需拉取，不做独立的双向同步。
> - **E2E**：已补 Prompt 三条链路（建/存/搜/恢复/复制、填充并复制、形态切换）。同步/离线/冲突
>   三条链路由服务端集成测试（53 例，含冲突副本与墓碑）与前端同步引擎单测覆盖，
>   跨进程 E2E 待集群部署后补一轮真机联调。
> - **PR 审查修正（2026-09-05）**：
>   - 增量拉取游标改用服务端写入时间 `syncedAt`（新列 + 迁移）——`updatedAt` 是客户端时钟，
>     离线修改后补推送会被其它设备的游标永久越过；墓碑删除同时推进 `updatedAt/syncedAt`，
>     否则游标较新的设备永远收不到删除。
>   - sync 端点的 collectionId 非法（不存在/他人集合）一律置空照常应用，不再让整批 400/500
>     卡死客户端队列；直接 CRUD 路由仍报 400。
>   - 客户端：删除 404（服务端从未见过该条目）视同已删除，避免队列永久停摆；「仅本地」切换
>     时清掉已在待推队列的旧版本，冲突副本保持仅本地下行墓碑不删仅本地条目；sync 在途期间的
>     新编辑不再被旧推送结果覆盖。
>   - 缓存/同步队列/合并向导标记全部按 `user.id` 分键——同浏览器先后登录不同账号互不串数据。
>   - 会话令牌哈希改为与 `SESSION_SECRET` 的 HMAC-SHA256（原先该变量必填但未使用）；
>     argon2 verify 不再传固定参数（避免将来调参导致旧哈希验证失败）。
>   - 定时任务增加过期会话与孤儿标签清理；搜索索引改为按列的 trgm GIN（原拼接表达式索引
>     服务不了 OR 查询形态）；server 镜像以 `USER node` 运行，配合 k3s 清单的 `runAsNonRoot`。

## 0. 一句话

把 VimPaste 从「打开即用、关掉即忘的临时编辑器」扩展为「临时编辑器 + 个人片段库」：
匿名用户体验完全不变，登录后可以把**命令**（现有形态）和 **Prompt**（自然语言片段）
存进自己的服务器，随时搜索、恢复、一键复制给 LLM。

## 1. 已确认的决策

| 决策         | 选择                                   | 理由                                                                                                                            |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 后端形态     | 自建 Node + PostgreSQL，部署到现有 k3s | 复用 Jenkins → ghcr → k3s-home GitOps 流水线；nginx 同源反代 `/api`，`connect-src 'self'` 的 CSP 一行都不用改；数据留在自己手里 |
| 账号体系     | 单用户为主，注册开关默认关闭           | 参考 Linkwarden 的 `DISABLE_REGISTRATION`；数据模型按多用户设计，将来开放不用改表                                               |
| 敏感内容     | 服务端存明文 + 逐条「仅本地」开关      | 服务端搜索、标题预览、密码找回都要明文；真正敏感的条目用「仅本地」拦在浏览器里。端到端加密列为 v3 备选                          |
| GitHub Pages | 保持匿名本地版，登录只在 k3s 版        | Pages 继续做「打开即用、不上传」的演示与隐私招牌；靠构建开关 `VITE_CLOUD_ENABLED` 把账号代码整体摇树掉                          |
| 数据库实例   | 新建专用 Postgres，不复用集群已有实例  | 生命周期与 VimPaste 绑定，版本、参数、PVC 都独立，删应用时不牵连别的服务                                                        |
| 访问域名     | 沿用现有域名，不新增                   | API 挂在同域名的 `/api/` 路径下——这正是同源方案的前提；证书与 Ingress 主机名都不用动，Cookie 的 `Secure` 直接可用               |
| 数据备份     | 不做                                   | 已确认接受「PVC 挂了数据就没了」；不引入 CronJob 与集群外存储依赖。兜底只留一个前端的「导出为 JSON」按钮，见 §10 风险 5         |

## 2. 从 Linkwarden 借鉴什么

Linkwarden 是自托管的书签管理器（Next.js + Prisma + PostgreSQL + NextAuth，
19k stars）。它解决的问题结构和我们高度相似：**一堆需要归档、检索、快速取用的小片段**。

值得直接照抄的：

- **`Collection` + `Tag` 双轴分类**：Collection 是单归属的「文件夹」，Tag 是多对多的「标签」，
  Tag 用 `@@unique([name, ownerId])` 保证每人的标签名唯一。我们把 `Link` 换成 `Snippet` 即可。
- **`type` 字段区分内容形态**：Linkwarden 的 `Link.type` 区分 url/pdf/image。
  我们用 `Snippet.kind` 区分 `command` / `prompt`——同一张表、同一套 CRUD 和搜索，
  只在编辑器行为和列表渲染上分叉。这比拆两张表省掉大量重复代码。
- **注册开关环境变量**：`DISABLE_REGISTRATION` 让同一份镜像既能当单人自托管，也能开放注册。
- **docker-compose 自托管路线**：应用 + Postgres 一把起，本地开发和生产用同一套编排。

明确**不抄**的：

- Meilisearch 独立搜索服务：我们的量级（个人几千条）用 Postgres `pg_trgm` GIN 索引就够，
  少一个要维护的容器。留作后续可选。
- NextAuth：我们不是 Next.js 项目，且只需要邮箱密码一种方式，自己写一张 `Session` 表更简单可控。
- 抓取/归档 worker、订阅、协作成员、订阅计费：完全用不上。

## 3. 目标与非目标

### 3.1 v2 目标

- 邮箱 + 密码登录，服务端会话，可吊销；注册默认关闭。
- 片段库支持两种类型：
  - **命令**（`command`）：与现在完全一致——语言识别、语法高亮、占位符 `]v` / `[v` 导航。
  - **Prompt**（`prompt`）：自然语言片段——软换行、不做语言识别、`{{变量}}` 占位符、一键复制。
- 云端持久化：跨设备、跨浏览器可见；支持搜索、集合、标签、置顶。
- 本地优先：未登录时行为与今天一模一样（localStorage）；登录后本地缓存 + 后台同步，离线可读可写。
- 逐条「仅本地」开关：标记后永不离开浏览器。
- 首次登录时询问是否把本机既有历史合并到云端。

### 3.2 v2 非目标

- 端到端加密（v3 再评估，见 §10 风险）。
- 多人协作、共享链接、公开分享。
- 在网页里执行命令、SSH、AI 改写。
- 移动端原生 App、浏览器扩展。
- 全文语义检索 / 向量搜索。

## 4. 架构

### 4.1 仓库结构

现有根目录仍然是前端包，**新增一个独立的 `server/` 包**（不引入 npm workspaces，
避免动到现有 `npm ci` 与 Dockerfile 的层缓存策略）：

```
vimpaste/
├── src/                    前端（现状，新增 auth/ sync/ 目录）
├── server/                 ← 新增，独立 package.json
│   ├── src/
│   │   ├── index.ts        Fastify 启动
│   │   ├── env.ts          环境变量 schema 校验（启动即失败）
│   │   ├── auth/           注册 / 登录 / 会话 / 密码哈希
│   │   ├── routes/         snippets / collections / tags / auth / health
│   │   ├── schemas/        zod 请求响应 schema
│   │   └── db.ts           Prisma client 单例
│   ├── prisma/schema.prisma
│   ├── prisma/migrations/
│   ├── tests/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml      ← 新增：本地起 api + postgres
├── Dockerfile              前端镜像（现状，仅新增一个构建参数）
└── nginx.conf              ← 修改：新增 /api/ 反向代理
```

### 4.2 运行拓扑（k3s）

```
                  Ingress (vimpaste.<域名>)
                          │
                  ┌───────▼────────┐
                  │ vimpaste (web) │  nginx: 静态 dist + /api/ 反代
                  └───────┬────────┘
                          │ proxy_pass http://vimpaste-api:3000
                  ┌───────▼────────┐
                  │ vimpaste-api   │  Fastify (Node 24)
                  └───────┬────────┘
                          │
                  ┌───────▼────────┐
                  │ postgres       │  专用实例：StatefulSet + PVC（新建，不复用）
                  └────────────────┘
```

**同源是这套设计的关键**：浏览器只访问 `https://<域名>/api/...`，于是
CSP 的 `connect-src 'self'` 不用放开、不需要 CORS、Cookie 可以用 `SameSite=Strict`。
三件本来最容易出安全事故的事情一次性绕开。

### 4.3 前端分层

新增一层存储抽象，让 UI 不关心数据在哪：

```ts
// src/storage/SnippetStore.ts
interface SnippetStore {
  list(filter: SnippetFilter): Promise<Snippet[]>
  upsert(snippet: Snippet): Promise<Snippet>
  remove(id: string): Promise<void>
}
```

- `LocalSnippetStore`：localStorage，未登录时使用，也是登录后的本地缓存。
- `CloudSnippetStore`：`LocalSnippetStore` 之上包一层同步队列，读走本地（瞬时响应），
  写先落本地再入队推送。

`src/storage/history.ts` 的 `HistoryEntry` 演进为 `Snippet`（字段向后兼容，见 §5.3 迁移）。

## 5. 数据模型

### 5.1 Prisma schema（server/prisma/schema.prisma）

```prisma
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  name         String?
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  sessions    Session[]
  snippets    Snippet[]
  collections Collection[]
  tags        Tag[]
}

/// 服务端会话表：Cookie 里是随机 token，库里只存它的 SHA-256，可单条吊销
model Session {
  id        String   @id            // sha256(token)
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  userAgent String?

  @@index([userId])
}

model Collection {
  id       Int      @id @default(autoincrement())
  name     String
  color    String   @default("#c96442")
  order    Int      @default(0)
  ownerId  Int
  owner    User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  snippets Snippet[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([name, ownerId])
  @@index([ownerId])
}

enum SnippetKind {
  command
  prompt
}

model Snippet {
  /// 客户端生成的 UUID：离线新建的条目在同步前就有稳定 id，不需要 id 重映射
  id      String      @id @db.Uuid
  kind    SnippetKind
  title   String
  content String
  /// 仅 command 有意义；取值由前端 isLangId() 白名单校验后写入
  langId  String      @default("plaintext")

  pinned     Boolean   @default(false)
  usageCount Int       @default(0)
  lastUsedAt DateTime?

  collectionId Int?
  collection   Collection? @relation(fields: [collectionId], references: [id], onDelete: SetNull)
  tags         Tag[]

  ownerId Int
  owner   User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  createdAt DateTime
  updatedAt DateTime
  /// 软删除墓碑：同步端据此在其它设备上执行删除，30 天后由定时任务硬删
  deletedAt DateTime?

  @@index([ownerId, updatedAt])
  @@index([ownerId, kind, updatedAt])
}

model Tag {
  id       Int       @id @default(autoincrement())
  name     String
  ownerId  Int
  owner    User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  snippets Snippet[]
  createdAt DateTime @default(now())

  @@unique([name, ownerId])
  @@index([ownerId])
}
```

**为什么 `createdAt` / `updatedAt` 不用 `@default(now())`**：时间戳由客户端提供，
才能表达「这条是我三天前在另一台机器上离线改的」。服务端只做合理性钳制
（不接受未来时间超过 5 分钟、不接受 1970）。

### 5.2 搜索索引

```sql
-- 迁移中手写
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX snippet_search_idx ON "Snippet"
  USING GIN ((title || ' ' || content) gin_trgm_ops);
```

查询用 `ILIKE '%kw%'`，中英文都能命中，个人量级（万条以内）毫秒级。
超出后再上 Meilisearch / `tsvector`，接口不用改。

### 5.3 本地数据迁移

现有 localStorage 键 `vimpaste.history.v1`，条目为
`{ id, title, content, langId, createdAt, updatedAt }`。

新键 `vimpaste.snippets.v2`，条目增加 `kind`（旧数据一律 `'command'`）、
`pinned`、`localOnly`、`collectionId`、`tags`、`deletedAt`、`syncState`。

迁移策略：启动时若发现 v1 键存在且 v2 键不存在，读 v1 → 补默认字段 → 写 v2 →
**保留 v1 键不删**（一个版本的回滚窗口），下一个版本再清理。
现有 `sanitizeEntry()` 的白名单清洗逻辑原样保留并扩展——它是这个模块最有价值的部分。

同时把上限从 30 条放宽：登录用户本地缓存 500 条 / 单条 10 万字符不变；
匿名用户维持 30 条（避免未登录用户把 localStorage 撑爆）。

## 6. API 设计

统一响应信封（遵循项目规范）：

```ts
type ApiResponse<T> =
  | { ok: true; data: T; meta?: { total: number; cursor?: string } }
  | { ok: false; error: { code: string; message: string } }
```

所有请求体经 zod 校验，校验失败返回 `400 VALIDATION_FAILED` 且不回显原始输入。

| 方法                    | 路径                     | 说明                                                                 |
| ----------------------- | ------------------------ | -------------------------------------------------------------------- |
| `POST`                  | `/api/auth/register`     | 注册；`DISABLE_REGISTRATION=true` 时返回 403                         |
| `POST`                  | `/api/auth/login`        | 登录，下发会话 Cookie                                                |
| `POST`                  | `/api/auth/logout`       | 吊销当前会话                                                         |
| `GET`                   | `/api/auth/me`           | 当前用户；未登录返回 401                                             |
| `GET`                   | `/api/snippets`          | 查询：`kind`、`q`、`collectionId`、`tag`、`since`、`limit`、`cursor` |
| `POST`                  | `/api/snippets`          | 创建（幂等：id 已存在则按 upsert 处理）                              |
| `PATCH`                 | `/api/snippets/:id`      | 局部更新，带 `updatedAt` 做乐观并发                                  |
| `DELETE`                | `/api/snippets/:id`      | 软删除（写 `deletedAt`）                                             |
| `POST`                  | `/api/snippets/sync`     | 批量同步：上行变更 + 下行拉取（见 §7）                               |
| `GET/POST/PATCH/DELETE` | `/api/collections[/:id]` | 集合 CRUD                                                            |
| `GET`                   | `/api/tags`              | 标签列表（含使用计数）                                               |
| `GET`                   | `/api/healthz`           | 存活探针，不查库                                                     |
| `GET`                   | `/api/readyz`            | 就绪探针，查库                                                       |

约束：

- 单条 `content` ≤ 100 000 字符；单用户条目数上限 `MAX_SNIPPETS_PER_USER`（默认 10 000）。
- 请求体上限 2 MB；`/api/auth/*` 限流 5 次/分钟/IP，失败按账号指数退避。
- 所有查询强制带 `ownerId = session.userId`，用 Prisma 的 `where` 强制注入，
  写一条集成测试专门验证「A 用户拿不到 B 用户的条目」。

## 7. 同步引擎

### 7.1 协议

一个端点搞定，减少往返：

```
POST /api/snippets/sync
{ "since": 1735689600000, "changes": [ ...本地待推送的 Snippet... ] }
→
{ "ok": true, "data": { "applied": [id...], "conflicts": [{ id, server }], "pulled": [...], "now": 1735689700000 } }
```

- **下行**：返回 `updatedAt > since` 的所有条目（含 `deletedAt` 非空的墓碑）。
- **上行**：逐条比较 `updatedAt`。
- **冲突**：客户端 `updatedAt` 早于服务端 → 不覆盖，放进 `conflicts` 回传。
  客户端把本地版本**另存为一条新条目**，标题加后缀 `（冲突副本）`。
  绝不静默丢弃用户写过的字——这是这一段唯一不能妥协的规则。
- **删除**：软删除 + 墓碑传播，30 天后服务端定时硬删。

### 7.2 触发时机

- 登录成功后立即全量拉取（`since=0`）。
- 本地写入后防抖 2 秒推送（与现有 `HISTORY_SAVE_DEBOUNCE_MS = 1500` 的自动保存串联）。
- 窗口 `focus` 事件 + 每 5 分钟轮询。
- `navigator.onLine` 从 false 变 true 时立刻冲刷队列。

### 7.3 离线

队列持久化在 localStorage（`vimpaste.syncqueue.v1`）。失败重试用指数退避
（1s / 2s / 4s… 上限 5 分钟），连续失败在状态栏显示「同步暂停 · 重试中」，
可点击手动重试。**离线时所有编辑照常可用**——这是 PWA 的既有承诺，不能退化。

### 7.4 「仅本地」条目

`localOnly: true` 的条目：

- 永不入同步队列，永不出现在任何请求体里；
- 在库面板里带一个锁形图标和 `仅本地` 标签；
- 换设备看不到，且明确告知用户「清掉浏览器数据就没了」。

新建条目时可一键切换；标记为「仅本地」的已同步条目，会先向服务端发一次删除再转本地。

## 8. Prompt 类型的前端行为

`kind` 决定编辑器与列表的行为差异，其余（复制、历史、搜索、主题、键位）完全共用。

| 维度        | `command`                                   | `prompt`                                                   |
| ----------- | ------------------------------------------- | ---------------------------------------------------------- |
| 语言识别    | 现有两层识别                                | 关闭，固定 `plaintext` / `markdown`                        |
| 语法高亮    | 按识别结果                                  | Markdown 轻高亮（标题、列表、代码块）                      |
| 自动换行    | 关闭（长行横向滚动，避免改变命令含义）      | **开启** `EditorView.lineWrapping`（散文横向滚动无法阅读） |
| 占位符      | `YOUR_TOKEN` / `<IP>` / `${VAR}` 等现有规则 | 新增 `{{变量}}`、`[待填写]`、`【主题】`                    |
| `]v` / `[v` | 保持                                        | 保持（跳的是 `{{变量}}`）                                  |
| 状态栏      | 语言 + 光标 + 字符数                        | 字数 + 预估 token 数（字符数 / 4 的粗略值，标注为估算）    |

新建入口：库面板顶部 `+ 新建` 拆成两个按钮 `新建命令` / `新建 Prompt`；
库列表顶部加 `全部 / 命令 / Prompt` 三个筛选 chip。

**变量填充（Phase 6，Prompt 的核心价值）**：
打开一条含 `{{语言}}`、`{{代码}}` 的 prompt 时，面板上方出现一个小表单，
每个变量一个输入框，填完点「填充并复制」——直接得到可以粘给 LLM 的成品，
不需要在正文里手动找位置改。原文不被修改，只影响复制出去的内容。

## 9. 分阶段实施

每个阶段都是可独立提交、可回滚的完整增量。测试按项目规范先写（TDD），覆盖率 ≥ 80%。

### Phase 0 · 骨架与决策落地（0.5 天）

- [ ] 创建 `server/` 包：TypeScript 严格模式、ESLint、Prettier 复用根配置风格
- [ ] `docker-compose.yml`：`postgres:17-alpine` + api，本地 `npm run dev` 一把起
- [ ] `server/src/env.ts`：用 zod 校验环境变量，缺失即启动失败（不允许运行时才炸）
- [ ] 本地 Postgres 版本与集群保持一致（`postgres:17-alpine`），避免迁移在两边行为不同
- **验收**：`docker compose up` 后 `curl localhost:3000/api/healthz` 返回 200

### Phase 1 · 数据层（1 天）

- [ ] Prisma schema（§5.1）+ 首个迁移 + `pg_trgm` 索引迁移
- [ ] `db.ts` Prisma 单例；连接池与超时配置
- [ ] seed 脚本 + 测试数据库（`vitest` + testcontainers 或独立测试库）
- **验收**：迁移可 up/down；模型层单测通过

### Phase 2 · 认证（1.5 天）

- [ ] argon2id 密码哈希（`@node-rs/argon2`），参数写常量、注释说明取值依据
- [ ] 会话：随机 32 字节 token，Cookie `httpOnly; Secure; SameSite=Strict; Path=/`，
      库里存 `sha256(token)`，30 天滑动过期
- [ ] `Origin` 请求头校验（同源之外一律拒绝）作为 CSRF 的第二道防线
- [ ] `@fastify/rate-limit` 限流；登录失败按账号指数退避
- [ ] `DISABLE_REGISTRATION`（默认 `true`）+ `npm run create-user` CLI 建首个账号
- [ ] 认证中间件：所有 `/api/snippets|collections|tags` 强制注入 `ownerId`
- **验收**：集成测试覆盖——注册关闭时 403、错密码不泄露账号是否存在、
  会话过期后 401、A 用户读不到 B 用户数据、限流生效
- **需 security-reviewer 过一遍**（项目规范：认证代码强制安全审查）

### Phase 3 · Snippet API（1.5 天）

- [ ] zod schema + `/api/snippets` 全部 CRUD + 分页（cursor）+ 搜索
- [ ] `/api/collections`、`/api/tags`
- [ ] 配额与体积限制、时间戳合理性钳制
- [ ] `/api/snippets/sync` 批量端点与冲突判定（§7.1）
- **验收**：契约测试覆盖每个端点的成功/校验失败/未授权/越权四种情况

### Phase 4 · 前端接入（2 天）

- [ ] `SnippetStore` 抽象 + `LocalSnippetStore`（含 v1 → v2 迁移）
- [ ] `VITE_CLOUD_ENABLED` 构建开关；关闭时账号相关模块整体不进包
- [ ] 登录 / 注册对话框（复用现有 `Dialog.tsx`），工具栏加账号入口
- [ ] `CloudSnippetStore` + 同步引擎 + 离线队列
- [ ] 首次登录合并向导：「本机有 N 条历史，合并到云端？」
- [ ] 状态栏文案随模式切换（§10 风险第一条）
- **验收**：未登录路径的现有单测与 E2E **一条不改地全绿**——这是本阶段的硬门槛

### Phase 5 · Prompt 类型（1.5 天）

- [ ] `kind` 贯通数据层 / API / UI
- [ ] 编辑器按 `kind` 切换换行与高亮（`createEditor.ts` 增加 compartment）
- [ ] `{{变量}}` 占位符规则接入现有 `detection/placeholders.ts`
- [ ] 库面板类型筛选、双新建入口、集合与标签的增删改
- **验收**：新增 E2E——建一条 prompt、存、刷新、搜到、恢复、复制

### Phase 6 · 变量填充（1 天）

- [ ] 解析 `{{var}}` 生成表单；填充后复制，不改原文
- [ ] 记住每个变量上次填的值（仅本地，`localOnly` 语义）
- **验收**：单测覆盖解析与替换；E2E 覆盖填充并复制

### Phase 7 · 部署（1.5 天）

- [ ] `server/Dockerfile`（多阶段，与前端 Dockerfile 同风格与注释密度）
- [ ] `Jenkinsfile` 增加 api 的测试、构建、推 ghcr 阶段
- [ ] `nginx.conf` 新增 `/api/` 反代 + `no-store`；
      PWA 加 `navigateFallbackDenylist: [/^\/api\//]`（防 SW 兜底吞掉 API 路由）
- [ ] k3s-home 清单：api Deployment/Service、Postgres StatefulSet + PVC、
      Secret（`DATABASE_URL`、`SESSION_SECRET`）、Ingress 路由
- 不做备份 CronJob（已确认）：数据可靠性风险已接受，见 §10 风险 5
- **验收**：推 main → 流水线绿 → 集群里登录、存一条、换设备看到

### Phase 8 · 文档与收尾（1 天）

- [ ] 重写 `README.md` 隐私段与 `docs/privacy.md`：明确区分 Pages 匿名版与自托管登录版
- [ ] `docs/self-hosting.md`：环境变量表、docker-compose 快速起步，以及「服务端不做备份」的明确告知
- [ ] 「导出全部为 JSON」按钮：不做备份之后唯一的兜底，见 §10 风险 5
- [ ] 复核 `scripts/check-build.mjs` 体积预算（当前 entry gzip ≤ 450 KB）
- [ ] E2E 补齐同步、离线、冲突三条链路
- **验收**：`npm run lint && npm run typecheck && npm test -- --run && npm run build && npm run test:e2e` 全绿

**合计约 11.5 人天。** Phase 0–3 是后端、4–6 是前端、7–8 是交付，前后端可以并行。

## 10. 风险与对策

**1. 隐私招牌与代码不一致（最高优先级）**
README 通篇写着「无后端、无账号、无分析统计」，状态栏固定显示
`Local only · 未上传`（`src/components/StatusBar.tsx:43`）。加了登录之后这些话在自托管版就是错的。
→ 对策：`VITE_CLOUD_ENABLED` 为 false 时文案完全不动；为 true 时状态栏按登录状态显示
`本地 · 未登录` / `已同步 · <时间>` / `同步暂停 · 重试中`。README 拆成两节分别描述两种部署。
**这一条必须和 Phase 4 同批次提交，不能留到 Phase 8。**

**2. 服务端明文存 Token**
用户会往里粘真实密钥。
→ 对策：（a）「仅本地」开关做在新建流程的显眼位置；（b）Postgres PVC 用加密存储；
（c）日志与错误上报绝不打印 `content` 字段，写一条测试断言这点；（d）文档明确说明威胁模型。

**3. Service Worker 吃掉 API 请求**
`navigateFallback: 'index.html'` 若命中 `/api/*` 会返回 HTML 导致解析失败。
→ 对策：`navigateFallbackDenylist`，并在 E2E 里跑一次「装了 SW 之后仍能登录」。

**4. 首屏体积**
新增认证、同步、集合标签 UI 会撑大入口包，`check-build.mjs` 会直接让构建失败。
→ 对策：账号与同步模块用动态 `import()` 按需加载；每个 Phase 结束跑一次 `npm run build` 看体积走势。

**5. 家用集群的数据可靠性（已知并接受）**
PVC 挂了片段库就没了，而这时用户很可能已经把 VimPaste 当成唯一存放处。
已确认**不做服务端备份**，这个风险是主动接受的，不是遗漏。
→ 仅有的两条缓解：（a）Phase 8 的「导出全部为 JSON」按钮，用户想留档时自己导；
（b）登录用户本地仍保留最近 500 条缓存，集群整个挂掉时浏览器里还有一份近期数据。
→ 文档必须把这一点写在自托管说明的显眼处，不能让人以为存进去就万无一失。

**6. 现有测试与体验回归**
匿名路径是产品的立身之本。
→ 对策：Phase 4 验收硬门槛——现有单测与 E2E 一行不改地全绿。任何需要修改现有测试的改动，
都要先说明为什么现有行为该变。

## 11. 环境变量

| 变量                       | 默认     | 说明                                                             |
| -------------------------- | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL`             | —        | 必填，Postgres 连接串                                            |
| `SESSION_SECRET`           | —        | 必填，≥ 32 字节随机值                                            |
| `DISABLE_REGISTRATION`     | `true`   | 关闭注册；单人自托管保持默认                                     |
| `MAX_SNIPPETS_PER_USER`    | `10000`  | 单用户条目上限                                                   |
| `MAX_CONTENT_CHARS`        | `100000` | 单条内容上限，与前端常量保持一致                                 |
| `TOMBSTONE_RETENTION_DAYS` | `30`     | 软删除墓碑保留天数                                               |
| `PORT`                     | `3000`   | 监听端口                                                         |
| `VITE_CLOUD_ENABLED`       | `false`  | **前端构建期**开关；Docker 镜像里设为 `true`，Pages 保持 `false` |

## 12. 开工前的待办

无阻塞项，Phase 0 可以直接开工。

原先的三个待定问题已确认，结论并入 §1 决策表：新建专用 Postgres；沿用现有域名；不做服务端备份。
