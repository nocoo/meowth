#!/usr/bin/env tsx
/**
 * L3 dev-fixture launcher.
 *
 * Boots a throw-away meowthd:
 *   1. tmp MEOWTH_HOME under os.tmpdir()
 *   2. `meowthd init` (path A) → first stdout line is the
 *      mwt_... root token
 *   3. Write token to a deterministic temp file the Playwright
 *      spec reads (path printed once on stdout for the user)
 *   4. `meowthd serve --bind 127.0.0.1:7777` → blocks until
 *      SIGINT / SIGTERM
 *
 * On shutdown the token file and the tmp MEOWTH_HOME are removed.
 * The token NEVER lands in the repo; it lives only in OS temp.
 *
 * docs/architecture/08 §3.4.1 dashboardDevFixture. Reused by
 * Playwright via playwright.config.ts → webServer.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const DAEMON_DIR = join(REPO_ROOT, 'daemon');
const TOKEN_FILE = join(tmpdir(), 'meowth-e2e-dev-token');
const HOME_MARKER = join(tmpdir(), 'meowth-e2e-dev-home-path');

function log(msg: string): void {
  process.stdout.write(`[e2e-dev-fixture] ${msg}\n`);
}

function cleanupTokenFile(): void {
  if (existsSync(TOKEN_FILE)) {
    try {
      unlinkSync(TOKEN_FILE);
    } catch {
      // best effort
    }
  }
  if (existsSync(HOME_MARKER)) {
    try {
      unlinkSync(HOME_MARKER);
    } catch {
      // best effort
    }
  }
}

// Always start from a clean slate so a stale token file from a
// crashed previous run can never be picked up as "valid".
cleanupTokenFile();

const home = mkdtempSync(join(tmpdir(), 'meowth-e2e-home-'));
// Write a non-secret marker pointing at the throw-away home so
// the Playwright globalTeardown can rmSync it even if SIGKILL
// prevented this script's handlers from running.
writeFileSync(HOME_MARKER, home, { encoding: 'utf8', mode: 0o600 });

function cleanup(): void {
  cleanupTokenFile();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  if (serveRef !== undefined) serveRef.kill('SIGTERM');
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  if (serveRef !== undefined) serveRef.kill('SIGTERM');
  cleanup();
  process.exit(143);
});
process.on('SIGHUP', () => {
  if (serveRef !== undefined) serveRef.kill('SIGTERM');
  cleanup();
  process.exit(129);
});

let serveRef: ReturnType<typeof spawn> | undefined;

// Step 1: mint a root token via `meowthd init` (path A).
const initResult = spawnSync('go', ['run', './cmd/meowthd', 'init'], {
  cwd: DAEMON_DIR,
  env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (initResult.status !== 0) {
  log(`init failed with status ${initResult.status}`);
  cleanup();
  process.exit(1);
}
// First stdout line of `meowthd init` (path A) is the root token.
// We do NOT log the token itself; only the path Playwright should
// read.
const firstLine = (initResult.stdout ?? '').split('\n', 2)[0]?.trim() ?? '';
if (!firstLine.startsWith('mwt_')) {
  log('init stdout did not start with mwt_ — refusing to write token file');
  cleanup();
  process.exit(1);
}
writeFileSync(TOKEN_FILE, firstLine, { encoding: 'utf8', mode: 0o600 });
log(`token written to ${TOKEN_FILE} (file mode 0o600)`);

// Step 2: serve. webServer waits for port 7777 to accept.
const serve = spawn(
  'go',
  ['run', './cmd/meowthd', 'serve', '--listen-addr', '127.0.0.1:7777'],
  {
    cwd: DAEMON_DIR,
    env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
serveRef = serve;

serve.on('exit', (code, signal) => {
  log(`meowthd serve exited code=${code} signal=${signal}`);
  cleanup();
  process.exit(code ?? 0);
});
