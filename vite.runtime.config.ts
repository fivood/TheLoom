import { defineConfig } from 'vite';

/**
 * 独立流程运行库构建(R9):
 *   npm run build:runtime → runtime-dist/theloom-runtime.js
 * 零依赖 ES Module,游戏引擎 / Node / 浏览器直接 import。
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/runtime/index.ts',
      formats: ['es'],
      fileName: () => 'theloom-runtime.js',
    },
    outDir: 'runtime-dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    minify: false,
  },
});
