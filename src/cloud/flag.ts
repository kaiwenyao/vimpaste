/**
 * 云功能构建期开关（plan-v2-accounts.md §11）。
 *
 * 注意：需要「按 import 调用点消除」的地方（App 里的动态 import 分支）直接写
 * `import.meta.env.VITE_CLOUD_ENABLED === 'true'` 内联判断——构建期 define 替换后
 * esbuild 能把整个分支连同动态 import 一起摇掉，保证 Pages 构建（false）不产出
 * 云端代码的 chunk。本文件导出的常量只用于非消除敏感的运行时判断。
 */
export const CLOUD_ENABLED: boolean = import.meta.env.VITE_CLOUD_ENABLED === 'true'
