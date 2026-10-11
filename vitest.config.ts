import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // 多个测试文件共用同一个 SQLite 文件，并行写入会触发 SQLITE_BUSY
  test: { include: ['tests/**/*.test.ts'], environment: 'node', fileParallelism: false },
})
