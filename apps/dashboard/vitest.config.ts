import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Phase 3.14 vitest config: env=jsdom so React component tests
// (DashboardLayout / AppSidebar / ThemeToggle / Spinner) can
// query the rendered DOM via @testing-library/react. The cn()
// pure-string test runs equally fine under jsdom.
export default defineConfig({
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/components/ui/**', 'src/index.css'],
    },
  },
});
