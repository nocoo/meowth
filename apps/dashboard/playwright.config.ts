import { defineConfig } from '@playwright/test';

// docs/architecture/08-6dq-hooks-wiring.md §3.4 — L3 fixtures.
//   - dashboard-dev   → §3.4.1 Vite dev + meowthd (path A via init) on :7777
//   - dashboard-embed → §3.4.2 daemon-embedded dashboard dist on :7777
//
// 3.20c lands the dev fixture: token handpaste happy + 401 redirect.
// Embed fixture stays as the existing placeholder; CSP / headers /
// XSS / Tokens secret modal / mint coverage land in later commits.
//
// Trace / video are intentionally OFF for dashboard-dev to avoid
// capturing localStorage values or action params that touch the
// freshly minted root token. The `<input type=password>` keeps the
// token out of failure screenshots even when capture is enabled.
export default defineConfig({
  testDir: 'e2e',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  // 30s per test is plenty for two simple navigation flows; raises
  // to 60s globally so the slow `go run` startup of the fixture
  // does not flake.
  timeout: 30_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      // Boots meowthd in a throw-away MEOWTH_HOME, mints a root
      // token via `meowthd init` (path A), writes it to a temp
      // file the specs read.
      command: 'pnpm tsx ../../scripts/e2e-dev-fixture.ts',
      url: 'http://127.0.0.1:7777/healthz',
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Vite dev server proxies /v1 + /healthz to 127.0.0.1:7777
      // (apps/dashboard/vite.config.ts). /bootstrap is intentionally
      // NOT proxied here (06 §3.4 + 04 §6.6).
      command: 'pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'dashboard-dev',
      use: {
        baseURL: 'http://localhost:5173',
      },
      testMatch: /dev\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed',
      testMatch: /embed\/.*\.spec\.ts$/,
    },
  ],
});
