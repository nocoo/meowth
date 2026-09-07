import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig(({ mode }) => {
  const { MEOWTH_DAEMON_URL: configuredDaemonUrl } = loadEnv(mode, __dirname, 'MEOWTH_');
  const daemonUrl = configuredDaemonUrl || 'http://127.0.0.1:7040';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react(), tailwind()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      host: '127.0.0.1',
      port: 37040,
      strictPort: true,
      allowedHosts: ['meowth.dev.hexly.ai', 'meowth-vite.dev.hexly.ai'],
      // HMR follows the browser origin: ws on loopback, wss through Caddy.
      proxy: {
        '/v1': { target: daemonUrl, changeOrigin: false },
        '/healthz': { target: daemonUrl, changeOrigin: false },
      },
      // Bootstrap mint stays on the daemon's loopback origin.
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
