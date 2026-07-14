import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // 把稳定的第三方依赖分到独立 chunk:应用代码迭代时,用户复用浏览器缓存的 vendor,不必重下
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@xyflow')) return 'flow-vendor';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/](zustand|yaml)[\\/]/.test(id)) return 'state-vendor';
          return 'vendor';
        },
      },
    },
  },
});
