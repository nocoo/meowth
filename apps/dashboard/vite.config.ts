import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// docs/architecture/06 §3 — Vite + Tailwind v4 + React 19 entry.
// Dev proxy ONLY for `/v1` and `/healthz`; `/bootstrap/*` is
// intentionally NOT proxied (06 §3.4) because the daemon's
// /bootstrap/mint origin gate would correctly reject the Vite origin.
// mint path B happy testing belongs to the production embed fixture
// in a later phase.
//
// Port layout (docs/features/01-port-migration-to-hexly-caddy.md):
//   37040 — Vite dev (this server); Caddy → meowth-vite.dev.hexly.ai
//    7040 — daemon meowthd (prod + dev); Caddy → meowth.dev.hexly.ai
// allowedHosts is required because Vite ≥5.0.12 rejects non-loopback
// Host headers by default (403 Blocked); the Caddy upstream forwards
// the original Host so we whitelist meowth-vite.dev.hexly.ai.
// HMR runs over wss through Caddy's TLS termination at port 443.

// docs/features/02 §4.2 / Stage B2 — APP_VERSION injection.
// Read dashboard's own package.json at build time so `__APP_VERSION__`
// in `lib/version.ts` reflects the published dashboard version.
// Source code never imports the package.json directly (which would
// pull a JSON module into the runtime bundle); the constant is
// substituted by Vite via `define`.
const PKG = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(PKG.version),
  },
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 37040,
    strictPort: true,
    allowedHosts: ['meowth-vite.dev.hexly.ai'],
    hmr: {
      host: 'meowth-vite.dev.hexly.ai',
      protocol: 'wss',
      clientPort: 443,
    },
    proxy: {
      '/v1': { target: 'http://127.0.0.1:7040', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:7040', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
