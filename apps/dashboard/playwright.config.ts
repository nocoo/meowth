import { defineConfig } from '@playwright/test';

// Phase 2.9 placeholder Playwright config.
// Two projects mirror docs/architecture/08-6dq-hooks-wiring.md §3.4:
//   - dashboard-dev   → §3.4.1 Vite dev + daemon (fake backend) on :7777
//   - dashboard-embed → §3.4.2 daemon-embedded dashboard dist on :7777
// Both projects currently match only their own placeholder spec via
// testMatch so each project reports exactly one skipped test. The real
// `use.baseURL`, `webServer`, browser channel, trace/screenshot/video,
// and 6 key flows from §4 are wired in later phases:
//   - dev fixture body:   Phase 3.13+ (Vite dev) and Phase 3.6 (daemon HTTP).
//   - embed fixture body: Phase 3.6 (daemon embed) + 06 §11 / 07 §11 L3 flows.
export default defineConfig({
  testDir: 'e2e',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    {
      name: 'dashboard-dev',
      testMatch: /dev\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed',
      testMatch: /embed\/.*\.spec\.ts$/,
    },
  ],
});
