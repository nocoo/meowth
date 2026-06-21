#!/usr/bin/env node
/**
 * scripts/run-l2.ts — Phase 2.8 placeholder L2 harness.
 *
 * What this does today
 * - Provisions an isolated test run dir under the D1 test root and exposes
 *   it via MEOWTH_TEST_HOME for the child daemon process.
 * - Builds the daemon binary (`pnpm daemon:build`).
 * - Runs `go run ./cmd/meowthd` (current daemon only prints its version).
 * - Asserts the process exits 0 with stdout matching `^meowthd `.
 * - Writes a per-step log to scripts/run-l2-output/run-l2.log.
 * - Cleans up only the per-run dir; never deletes the D1 test root or
 *   anything under the user's real $HOME/.meowth/.
 *
 * What this does NOT do (do NOT add in Phase 2.8)
 * - Start an HTTP server / poll /healthz — lands with Phase 3.6 (docs/architecture/02).
 * - Open a SQLite store or assert the D1 path/filename/marker triple
 *   — lands with Phase 3.3 (docs/architecture/03).
 * - Run `meowthd init --skip-token` or the mint suite — lands with Phase 3.5
 *   (docs/architecture/04).
 * - Mount the fake backend or honour MEOWTH_BACKEND_FACTORY=fake — lands
 *   with the fake backend commit per docs/architecture/08 §3.3.1 / §13 #1.
 * - Validate response envelopes against the OpenAPI schema — lands with
 *   docs/architecture/02 §13 / docs/architecture/08 §9.
 * - The MEOWTH_TEST=1 env is set on the child for forward compatibility,
 *   but the current daemon does not read it; nothing about test-mode
 *   guard is verified by this harness yet.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-l2.log');

const stdoutWrite = (msg: string): void => {
  process.stdout.write(msg);
};
const stderrWrite = (msg: string): void => {
  process.stderr.write(msg);
};

function log(line: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

function step(label: string, fn: () => void): void {
  stdoutWrite(`L2 ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    fn();
    log(`OK   ${label}`);
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2 ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

// Track whether we created TEST_ROOT ourselves so we know whether it is safe
// to remove on cleanup. If it already existed, leave it alone.
const testRootPreexisting = existsSync(TEST_ROOT);

// Prepare output dir + truncate log before any steps so failures still land
// in the log file rather than appearing only on stderr.
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  LOG_PATH,
  `# Phase 2.8 L2 harness run\n# repo: ${REPO_ROOT}\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
);

let runHome = '';

// Always-on cleanup, registered before the first failure-prone step so a
// crash mid-harness doesn't leave per-run dirs lying around. The handler
// is best-effort and only touches paths we ourselves created above.
function cleanup(): void {
  if (runHome && existsSync(runHome)) {
    try {
      rmSync(runHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  if (!testRootPreexisting && existsSync(TEST_ROOT)) {
    try {
      rmdirSync(TEST_ROOT);
    } catch {
      // Non-empty (someone else added files while we ran) — leave it.
    }
  }
}
process.on('exit', cleanup);

step('prepare D1 test root and per-run dir', () => {
  mkdirSync(TEST_ROOT, { recursive: true });
  runHome = mkdtempSync(join(TEST_ROOT, 'run-'));
  log(`runHome=${runHome}`);
});

step('build daemon binary', () => {
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });
});

step('run meowthd version probe', () => {
  const r = spawnSync('go', ['run', './cmd/meowthd'], {
    cwd: join(REPO_ROOT, 'daemon'),
    encoding: 'utf8',
    env: {
      ...process.env,
      MEOWTH_TEST: '1',
      MEOWTH_TEST_HOME: runHome,
    },
  });
  if (r.status !== 0) {
    throw new Error(`meowthd exited ${String(r.status)}; stderr=${r.stderr}`);
  }
  const stdout = r.stdout.trim();
  log(`stdout=${stdout}`);
  if (!/^meowthd /.test(stdout)) {
    throw new Error(`meowthd stdout did not match /^meowthd /: ${stdout}`);
  }
});

// Phase 3.7 lands the `serve` subcommand + healthz / token CRUD HTTP
// surface (commit feat(daemon): chi router + healthz + token CRUD).
// The real-HTTP L2 harness (spawn serve, poll /healthz, exercise
// token endpoints, SIGTERM) is wired in the immediate follow-up
// commit so this commit's diff stays focused on the daemon-side
// server package + sqlc + OpenAPI. Until then the version probe
// above is the only daemon-side L2 step.

step('cleanup per-run dir (preserve D1 test root)', () => {
  // Only remove the per-run directory we mkdtempSync'd. Never recursively
  // delete TEST_ROOT or anything above it.
  if (runHome && existsSync(runHome)) {
    rmSync(runHome, { recursive: true, force: true });
  }
  // If we created TEST_ROOT ourselves AND it is now empty, remove the empty
  // shell. If it pre-existed, leave it as we found it.
  if (!testRootPreexisting && existsSync(TEST_ROOT)) {
    try {
      rmdirSync(TEST_ROOT);
    } catch {
      // Non-empty (someone else added stuff while we ran) — leave it alone.
    }
  }
});

stdoutWrite('L2: OK (placeholder; real suites land with 02/03/04/05)\n');
log('DONE OK');
