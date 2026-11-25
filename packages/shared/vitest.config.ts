import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    passWithNoTests: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/types.ts',
      ],
    },
  },
});
