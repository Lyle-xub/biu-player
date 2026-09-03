import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React 重构版前端：源码在 web/，构建产物输出到 web-dist/（Electron 加载）。
// base './' 保证 file:// 协议下资源相对路径可用。
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: 'public',
  plugins: [react()],
  server: { port: 5173, fs: { allow: ['..'] } },
  // Vite 8 默认用 lightningcss 压缩 CSS，它按 targets 做前缀收敛，
  // 会把 backdrop-filter 的无前缀声明删掉只留 -webkit- 版，导致 Electron/Chromium
  // 里 computed style 为 none、毛玻璃整体失效。显式给 targets，让它同时保留两种声明。
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: {
        chrome: 100 << 16,
        safari: 15 << 16,
        ios_saf: 15 << 16,
      },
    },
  },
  build: { outDir: '../web-dist', emptyOutDir: true },
});
