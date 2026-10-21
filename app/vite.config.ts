import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [preact()],
  server: { port: 5178, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
});
