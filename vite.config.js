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
  build: { outDir: '../web-dist', emptyOutDir: true },
});
