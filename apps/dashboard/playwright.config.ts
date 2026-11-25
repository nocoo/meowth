import { defineConfig, devices } from '@playwright/test';

const EMBED_FIXTURE = '../../scripts/e2e-embed-fixture.ts';
const EMBED_MINT_FIXTURE = '../../scripts/e2e-embed-mint-fixture.ts';
const { CI } = process.env;

export default defineConfig({
  testDir: 'e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!CI,
  retries: CI ? 1 : 0,
  workers: 3,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:47040',
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'pnpm exec vite --port 47040 --strictPort',
      url: 'http://127.0.0.1:47040',
      env: { MEOWTH_DAEMON_URL: 'http://127.0.0.1:47041' },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm tsx ${EMBED_FIXTURE}`,
      url: 'http://127.0.0.1:17040/healthz',
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm tsx ${EMBED_MINT_FIXTURE}`,
      url: 'http://127.0.0.1:17041/healthz',
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
