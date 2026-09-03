import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(here, '..'), base: './', plugins: [react()],
  build: { outDir: '/tmp/biu-scroll-perf', emptyOutDir: true,
    rollupOptions: { input: path.join(here, 'scroll-perf.html') } },
});
