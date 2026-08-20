import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  // 正式建置時由 vite.config.ts 的 buildStamp() 注入；測試裡給一個固定值，
  // 否則任何引用 __BUILD_STAMP__ 的元件在測試中會直接 ReferenceError。
  define: {
    __BUILD_STAMP__: JSON.stringify({
      version: '0.0.0-test',
      commit: 'testtes',
      builtAt: '2026-01-01T00:00:00.000Z',
    }),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
