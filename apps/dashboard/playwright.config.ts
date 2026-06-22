import { type PlaywrightTestConfig, defineConfig } from '@playwright/test';

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
//
// Per-project webServer selection: Playwright runs every entry in
// `webServer` for every invocation, so an embed-only run would
// otherwise also boot the dev fixture + Vite (and vice versa).
// We sniff `--project=<name>` arguments and only include the
// webServer entries each selected project actually needs.

const DEV_FIXTURE = '../../scripts/e2e-dev-fixture.ts';
const EMBED_FIXTURE = '../../scripts/e2e-embed-fixture.ts';

const DEV_SERVERS: PlaywrightTestConfig['webServer'] = [
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
];

const EMBED_SERVERS: PlaywrightTestConfig['webServer'] = [
  {
    command: `pnpm tsx ${EMBED_FIXTURE}`,
    url: 'http://127.0.0.1:17777/healthz',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
];

function selectedProjects(argv: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' && i + 1 < argv.length) {
      out.add(argv[i + 1]);
    } else if (a?.startsWith('--project=')) {
      out.add(a.slice('--project='.length));
    }
  }
  return out;
}

function buildWebServers(): PlaywrightTestConfig['webServer'] {
  const sel = selectedProjects(process.argv);
  const wantDev = sel.size === 0 || sel.has('dashboard-dev');
  const wantEmbed = sel.size === 0 || sel.has('dashboard-embed');
  const entries: NonNullable<PlaywrightTestConfig['webServer']>[number][] = [];
  if (wantDev) entries.push(...(DEV_SERVERS as NonNullable<typeof DEV_SERVERS>));
  if (wantEmbed) entries.push(...(EMBED_SERVERS as NonNullable<typeof EMBED_SERVERS>));
  return entries;
}

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
  webServer: buildWebServers(),
  projects: [
    {
      name: 'dashboard-dev',
      use: { baseURL: 'http://localhost:5173' },
      testMatch: /dev\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed',
      fullyParallel: false,
      use: { baseURL: 'http://127.0.0.1:17777' },
      testMatch: /embed\/.*\.spec\.ts$/,
    },
  ],
  workers: 1,
});
