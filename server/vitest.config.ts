import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // 集成测试共享同一个 Postgres 实例：禁用文件级并行，避免 truncate 互相干扰
    fileParallelism: false,
  },
})
