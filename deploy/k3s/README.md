# k3s 部署清单（v2 参考副本）

本目录是 v2（账号 + 片段库 API）的 Kubernetes 清单**参考副本**。
GitOps 的唯一事实来源仍是 [kaiwenyao/k3s-home](https://github.com/kaiwenyao/k3s-home)
仓库的 `apps/vimpaste/`（web）与 `apps/vimpaste-api/`（api）——
Jenkins 的 GitOps 阶段只更新那边的镜像行。本目录与 GitOps 清单保持同步，
但部署时以 k3s-home 为准。

清单组成：

| 文件                        | 内容                                                     |
| --------------------------- | -------------------------------------------------------- |
| `api-deployment.yaml`       | vimpaste-api Deployment（启动时先 `prisma migrate deploy`） |
| `api-service.yaml`          | ClusterIP Service，web 的 nginx 通过它反代 /api/          |
| `postgres-statefulset.yaml` | 专用 Postgres 17（StatefulSet + PVC，不复用集群其他实例）  |
| `postgres-service.yaml`     | Postgres 的 ClusterIP Service                             |
| `sealed-secret.yaml`        | 数据库密码、连接串与会话密钥（strict-scope 加密清单）     |

`sealed-secret.yaml` 使用 `/Users/kaiwenyao/sealed-secrets-public.pem` 离线封印，
目标固定为 `dev/vimpaste-api-secrets`。名称或 namespace 改动、密钥轮换后必须重新
执行 `kubeseal`；明文不要写入仓库。

已确认的设计（plan-v2-accounts.md §1）：**不做服务端备份**——PVC 挂了数据就没了，
用户兜底是前端「导出 JSON」按钮与本地 500 条缓存。
