# 安全策略

## 报告漏洞

请通过 GitHub 私有漏洞报告（仓库 Security 标签页 → Report a vulnerability）或仓库 Issue 联系维护者。请勿在公开 Issue 中粘贴可复现的敏感内容。

## 设计边界

- VimPaste 不执行任何用户粘贴的命令，只负责编辑与复制。
- 编辑内容仅在浏览器内存中处理，不上传、不持久化（详见 docs/privacy.md）。
- 生产构建注入 CSP：脚本、连接与资源仅限同源；不加载任何第三方代码。
- 依赖通过 npm lockfile 固定版本；升级依赖时请运行完整测试（lint、typecheck、unit、build、e2e）。

## 支持范围

仅对 `main` 分支的最新版本提供修复。
