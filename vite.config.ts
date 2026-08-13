import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { version } from './package.json';

/**
 * R20-2:把独立运行库的构建产物作为字符串内嵌进应用,
 * 让「自包含引擎包」能把 theloom-runtime.js 一并打进导出的 zip。
 * 产物由 `npm run build:runtime` 生成(build 脚本已串好);
 * 缺失时导出为空串,界面据此禁用「包含运行库」选项而不是打出坏包。
 */
const RUNTIME_ID = 'virtual:theloom-runtime-source';
function runtimeSourcePlugin(): Plugin {
  const resolved = `\0${RUNTIME_ID}`;
  const distPath = new URL('./runtime-dist/theloom-runtime.js', import.meta.url);
  return {
    name: 'theloom-runtime-source',
    resolveId: (id) => (id === RUNTIME_ID ? resolved : undefined),
    load(id) {
      if (id !== resolved) return undefined;
      const source = existsSync(distPath) ? readFileSync(distPath, 'utf8') : '';
      if (!source) {
        this.warn('runtime-dist/theloom-runtime.js 不存在,自包含包将无法附带运行库;先跑 npm run build:runtime');
      }
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    runtimeSourcePlugin(),
    // PWA:仅网页版需要;桌面(Tauri)版由前端运行时 isTauri 跳过 SW 注册
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.svg'],
      manifest: {
        name: '叙事织机 TheLoom',
        short_name: 'TheLoom',
        description: '本地优先的叙事设计工具:流程编辑、实体库、大纲、时间线与文档写作',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#eceae6',
        background_color: '#eceae6',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          // 图标等图片静态资源:缓存优先
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: { cacheName: 'theloom-images' },
          },
          // 协作房间接口:网络优先,SW 不缓存房间密文,保持端到端加密边界
          {
            urlPattern: ({ url }) => url.pathname.includes('/functions/') || url.pathname.includes('/api/'),
            handler: 'NetworkOnly',
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
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
