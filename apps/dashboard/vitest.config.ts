import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Phase 3.13 vitest config: env=node is enough for the cn() L1
// test. jsdom / @testing-library land in Phase 3.14 when the app
// shell + ThemeToggle are introduced.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
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
