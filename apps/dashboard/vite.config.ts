import path from 'node:path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// docs/architecture/06 §3 — Vite + Tailwind v4 + React 19 entry.
// Dev proxy ONLY for `/v1` and `/healthz`; `/bootstrap/*` is
// intentionally NOT proxied (06 §3.4) because the daemon's
// /bootstrap/mint origin gate would correctly reject Origin
// `http://localhost:5173`. mint path B happy testing belongs to
// the production embed fixture in a later phase.
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:7777', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:7777', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
