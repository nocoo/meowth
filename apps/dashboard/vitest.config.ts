import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Phase 3.14 vitest config: env=jsdom so React component tests can
// query the rendered DOM via @testing-library/react. The cn()
// pure-string test runs equally fine under jsdom.
//
// Phase 2 dashboard redesign Stage B2: re-implement the same Vite
// `define` substitution under vitest so `lib/version.ts` and its
// consumers (Settings VM, sidebar version pill) read a real string
// at test time instead of the unresolved `__APP_VERSION__` global.
const PKG = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(PKG.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    // Pin jsdom to a real http origin so `window.localStorage` is a
    // usable Storage instance on every host. jsdom disables storage
    // when the document loads from an opaque origin (about:blank),
    // which on some Vitest configs surfaces as
    // `localStorage is not available`.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/components/ui/**', 'src/index.css'],
    },
  },
});
