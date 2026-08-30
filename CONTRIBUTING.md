# 贡献指南

## 开发流程

```bash
npm install
npm run dev
```

## 提交前必须通过的质量门槛

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

## 约定

- 提交信息使用简洁的祈使句（如 `feat: 占位符导航`）。
- 保持隐私红线：不要把编辑内容持久化到任何 Web 存储、URL 或日志；不要引入第三方分析、远程字体或会上传内容的服务。
- 新增依赖前请说明用途，优先保持零后端、纯静态架构。
- 改动涉及用户可见行为时，请同步更新 README 与帮助面板文案。
