import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
// Local Node.js edition; browser code never receives MySQL credentials.
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: 'localhost',
    port: 3000,
    strictPort: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key}',
        '**/.git/**',
        '**/.local/**',
        '**/*.sql',
        '**/server/**',
        '**/scripts/**',
        '**/tests/**',
      ],
    },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  plugins: [vinext(), sites()],
});
