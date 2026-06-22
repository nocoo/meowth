import { defineConfig } from '@playwright/test';

// docs/architecture/08-6dq-hooks-wiring.md §3.4 — L3 fixtures.
//   - dashboard-dev   → §3.4.1 Vite dev + meowthd (path A via init) on :7777
//   - dashboard-embed → §3.4.2 daemon-embedded dashboard dist on :17777
//
// 3.20c landed the dev fixture; 3.22 lands the embed fixture for
// happy path A (paste token, agents list, tokens dialog, fake exec
// + session render). CSP / headers / XSS / SecretReveal full and
// mint coverage land in later commits.
//
// Trace / video are intentionally OFF for both projects to avoid
// capturing localStorage values or action params that touch the
// freshly minted root token. The `<input type=password>` keeps the
// token out of failure screenshots even when capture is enabled.

const DEV_FIXTURE = '../../scripts/e2e-dev-fixture.ts';
const EMBED_FIXTURE = '../../scripts/e2e-embed-fixture.ts';

export default defineConfig({
  testDir: 'e2e',
  // Combined dev + embed cleanup; runs after the test session
  // regardless of how the webServer process died.
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  timeout: 60_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    // dev fixture: writes token to OS-temp, vite on :5173 proxies
    // /v1 + /healthz to meowthd on :7777.
    {
      command: `pnpm tsx ${DEV_FIXTURE}`,
      url: 'http://127.0.0.1:7777/healthz',
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    // embed fixture: meowthd with embedded dashboard on :17777,
    // MEOWTH_BACKEND_FACTORY=fake. Fixed port; if 17777 is in use
    // the fixture fails fast rather than killing the owner.
    {
      command: `pnpm tsx ${EMBED_FIXTURE}`,
      url: 'http://127.0.0.1:17777/healthz',
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'dashboard-dev',
      use: { baseURL: 'http://localhost:5173' },
      testMatch: /dev\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed',
      // Single daemon + single sqlite home: serial execution only.
      fullyParallel: false,
      use: { baseURL: 'http://127.0.0.1:17777' },
      testMatch: /embed\/.*\.spec\.ts$/,
    },
  ],
  // Within the dashboard-embed project we want serial; the global
  // workers=1 keeps things simple across both projects when running
  // `dashboard:e2e` end-to-end. Individual project runs (CLI
  // `--project=dashboard-dev`) inherit the same cap; dev tests are
  // fast and run sequentially with no observable slowdown.
  workers: 1,
});
