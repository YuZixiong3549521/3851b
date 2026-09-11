import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: '/technician/',
  resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: '../public/technician', emptyOutDir: true },
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } },
});
