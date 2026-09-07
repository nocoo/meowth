import { type PlaywrightTestConfig, defineConfig } from '@playwright/test';

// docs/architecture/08-6dq-hooks-wiring.md §3.4 — L3 fixtures.
//   - dashboard-dev        → §3.4.1 Vite dev + meowthd path A on :47041 (Vite :47040)
//   - dashboard-ui         → isolated Vite + mocked API on :47040
//   - dashboard-embed      → §3.4.2 daemon-embedded dashboard dist on :17040
//                            (mint window CLOSED — token already exists)
//   - dashboard-embed-mint → §3.4.2 daemon-embedded dist on :17041, booted
//                            via `init --skip-token` so the first-run mint
//                            window is OPEN for happy path B coverage
//
// 3.20c landed the dev fixture; 3.22 lands the embed fixture for
// happy path A (paste token, agents list, tokens dialog, fake exec
// + session render); 3.23 lands the embed-mint fixture for happy
// path B (paste setup-code → mint → /overview). CSP / headers / XSS
// / SecretReveal full coverage land in 3.24.
//
// Trace / video are intentionally OFF for all projects to avoid
// capturing localStorage values or action params that touch the
// freshly minted root token or setup-code. The `<input
// type=password>` keeps both secrets out of failure screenshots
// even when capture is enabled.
//
// Per-project webServer selection: Playwright runs every entry in
// `webServer` for every invocation, so an embed-only run would
// otherwise also boot the dev fixture + Vite (and vice versa).
// We sniff `--project=<name>` arguments and only include the
// webServer entries each selected project actually needs.

const DEV_FIXTURE = '../../scripts/e2e-dev-fixture.ts';
const EMBED_FIXTURE = '../../scripts/e2e-embed-fixture.ts';
const EMBED_MINT_FIXTURE = '../../scripts/e2e-embed-mint-fixture.ts';

type WebServerConfig = Exclude<PlaywrightTestConfig['webServer'], undefined | unknown[]>;

const VITE_SERVER: WebServerConfig = {
  command: 'pnpm exec vite --port 47040 --strictPort',
  url: 'http://127.0.0.1:47040',
  env: { MEOWTH_DAEMON_URL: 'http://127.0.0.1:47041' },
  timeout: 60_000,
  reuseExistingServer: false,
};

const DEV_SERVERS: WebServerConfig[] = [
  {
    command: `pnpm tsx ${DEV_FIXTURE}`,
    url: 'http://127.0.0.1:47041/healthz',
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  VITE_SERVER,
];

const EMBED_SERVERS: WebServerConfig[] = [
  {
    command: `pnpm tsx ${EMBED_FIXTURE}`,
    url: 'http://127.0.0.1:17040/healthz',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
];

const EMBED_MINT_SERVERS: WebServerConfig[] = [
  {
    command: `pnpm tsx ${EMBED_MINT_FIXTURE}`,
    url: 'http://127.0.0.1:17041/healthz',
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
    const next = argv[i + 1];
    if (a === '--project' && next !== undefined) {
      out.add(next);
    } else if (a?.startsWith('--project=')) {
      out.add(a.slice('--project='.length));
    }
  }
  return out;
}

function buildWebServers(): WebServerConfig[] {
  const sel = selectedProjects(process.argv);
  const wantDev = sel.size === 0 || sel.has('dashboard-dev');
  const wantUi = sel.size === 0 || sel.has('dashboard-ui');
  const wantEmbed = sel.size === 0 || sel.has('dashboard-embed');
  const wantEmbedMint = sel.size === 0 || sel.has('dashboard-embed-mint');
  const entries: WebServerConfig[] = [];
  if (wantDev) entries.push(...DEV_SERVERS);
  if (wantUi && !wantDev) entries.push(VITE_SERVER);
  if (wantEmbed) entries.push(...EMBED_SERVERS);
  if (wantEmbedMint) entries.push(...EMBED_MINT_SERVERS);
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
      name: 'dashboard-ui',
      use: { baseURL: 'http://127.0.0.1:47040' },
      testMatch: /ui\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-dev',
      use: { baseURL: 'http://127.0.0.1:47040' },
      testMatch: /dev\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed',
      fullyParallel: false,
      use: { baseURL: 'http://127.0.0.1:17040' },
      testMatch: /embed\/.*\.spec\.ts$/,
    },
    {
      name: 'dashboard-embed-mint',
      fullyParallel: false,
      use: { baseURL: 'http://127.0.0.1:17041' },
      testMatch: /embed-mint\/.*\.spec\.ts$/,
    },
  ],
  workers: 1,
});
