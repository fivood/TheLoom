import { defineConfig } from 'vite';

/**
 * 无界面导出 CLI 构建(R20-3):
 *   npm run build:cli → cli-dist/theloom-cli.mjs
 * 单文件 ES Module,除 node 内置模块外零依赖(yaml 等被一并打进来)。
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/cli/main.ts',
      formats: ['es'],
      fileName: () => 'theloom-cli.mjs',
    },
    outDir: 'cli-dist',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [/^node:/],
      output: { banner: '#!/usr/bin/env node' },
    },
  },
});
