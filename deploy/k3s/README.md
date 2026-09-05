# k3s 部署清单（v2 参考副本）

本目录是 v2（账号 + 片段库 API）的 Kubernetes 清单**参考副本**。
GitOps 的唯一事实来源仍是 [kaiwenyao/k3s-home](https://github.com/kaiwenyao/k3s-home)
仓库的 `apps/vimpaste/`（web）与 `apps/vimpaste-api/`（api）——
Jenkins 的 GitOps 阶段只更新那边的镜像行。合并本 PR 后需把这份清单
（去掉本 README）拷贝/合并进 k3s-home 并提交一次。

清单组成：

| 文件                        | 内容                                                     |
| --------------------------- | -------------------------------------------------------- |
| `api-deployment.yaml`       | vimpaste-api Deployment（启动时先 `prisma migrate deploy`） |
| `api-service.yaml`          | ClusterIP Service，web 的 nginx 通过它反代 /api/          |
| `postgres-statefulset.yaml` | 专用 Postgres 17（StatefulSet + PVC，不复用集群其他实例）  |
| `postgres-service.yaml`     | Postgres 的 ClusterIP Service                             |
| `secret.example.yaml`       | `DATABASE_URL` / `SESSION_SECRET` 的 Secret 模板          |

已确认的设计（plan-v2-accounts.md §1）：**不做服务端备份**——PVC 挂了数据就没了，
用户兜底是前端「导出 JSON」按钮与本地 500 条缓存。
