/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** 构建期开关：Docker 镜像 true，GitHub Pages 匿名版 false（plan-v2-accounts.md §11） */
  readonly VITE_CLOUD_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
