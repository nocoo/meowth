#!/usr/bin/env tsx
/**
 * L3 embed-fixture launcher (docs/architecture/08 §3.4.2).
 *
 * Self-contained: runs `pnpm daemon:build` so a fresh checkout can
 * boot without manual setup, then `go build -o
 * scripts/run-l2-output/meowthd-embed ./cmd/meowthd` to produce a
 * standalone binary with the freshly embedded dashboard dist.
 *
 * The fixture mints a root token via path A (`meowthd init`),
 * writes it to OS-temp with mode 0o600, writes a home marker, and
 * spawns `meowthd serve --listen-addr 127.0.0.1:17040` with
 * MEOWTH_TEST=1 + MEOWTH_BACKEND_FACTORY=fake so /v1/agents and
 * exec endpoints work without real CLIs.
 *
 * Cleanup is best-effort on SIGINT/SIGTERM/SIGHUP/exit; the
 * Playwright globalTeardown handles SIGKILL paths.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  createServer,
  type AddressInfo,
} from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const DAEMON_DIR = join(REPO_ROOT, 'daemon');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts/run-l2-output');
const BINARY = join(OUTPUT_DIR, 'meowthd-embed');
const TOKEN_FILE = join(tmpdir(), 'meowth-e2e-embed-token');
const HOME_MARKER = join(tmpdir(), 'meowth-e2e-embed-home-path');
const FIXED_PORT = 17040;

function log(msg: string): void {
  process.stdout.write(`[e2e-embed-fixture] ${msg}\n`);
}

function cleanupArtifacts(): void {
  for (const f of [TOKEN_FILE, HOME_MARKER]) {
    if (existsSync(f)) {
      try {
        unlinkSync(f);
      } catch {
        // best effort
      }
    }
  }
}

cleanupArtifacts();

// Port availability check: try to bind 17040; if it fails the port
// is already in use, fail fast with a clear message. We do NOT kill
// the owning process — test scripts must not nuke unknown PIDs.
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const probe = createServer();
    probe.once('error', (err) => {
      rejectP(
        new Error(
          `port ${port} already in use (${(err as NodeJS.ErrnoException).code}); ` +
            'free it manually before re-running e2e:embed',
        ),
      );
    });
    probe.listen(port, '127.0.0.1', () => {
      const info = probe.address() as AddressInfo;
      probe.close(() => resolveP(info ? undefined : undefined));
    });
  });
}

async function main(): Promise<void> {
  log(`port preflight on 127.0.0.1:${FIXED_PORT}`);
  await assertPortFree(FIXED_PORT);

  log('pnpm daemon:build (dashboard build + prepare + go build)');
  const build = spawnSync('pnpm', ['daemon:build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) throw new Error(`pnpm daemon:build status ${build.status}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  log(`go build -o ${BINARY} ./cmd/meowthd`);
  const goBuild = spawnSync('go', ['build', '-o', BINARY, './cmd/meowthd'], {
    cwd: DAEMON_DIR,
    stdio: 'inherit',
  });
  if (goBuild.status !== 0) throw new Error(`go build status ${goBuild.status}`);

  const home = mkdtempSync(join(tmpdir(), 'meowth-e2e-embed-home-'));
  writeFileSync(HOME_MARKER, home, { encoding: 'utf8', mode: 0o600 });

  process.on('exit', () => {
    cleanupArtifacts();
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  log('meowthd init under MEOWTH_TEST_HOME');
  const initRes = spawnSync(BINARY, ['init'], {
    env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (initRes.status !== 0) throw new Error(`meowthd init status ${initRes.status}`);
  const first = (initRes.stdout ?? '').split('\n', 2)[0]?.trim() ?? '';
  if (!first.startsWith('mwt_')) throw new Error('init stdout did not start with mwt_');
  writeFileSync(TOKEN_FILE, first, { encoding: 'utf8', mode: 0o600 });
  log(`token written to ${TOKEN_FILE} (0o600)`);

  log(`meowthd serve --listen-addr 127.0.0.1:${FIXED_PORT} (fake backend)`);
  const serve = spawn(
    BINARY,
    ['serve', '--listen-addr', `127.0.0.1:${FIXED_PORT}`],
    {
      cwd: DAEMON_DIR,
      env: {
        ...process.env,
        MEOWTH_TEST_HOME: home,
        MEOWTH_TEST: '1',
        MEOWTH_BACKEND_FACTORY: 'fake',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  function shutdown(signal: NodeJS.Signals, code: number): void {
    if (!serve.killed) {
      try {
        serve.kill(signal);
      } catch {
        // best effort
      }
    }
    cleanupArtifacts();
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best effort
    }
    process.exit(code);
  }
  process.on('SIGINT', () => shutdown('SIGTERM', 130));
  process.on('SIGTERM', () => shutdown('SIGTERM', 143));
  process.on('SIGHUP', () => shutdown('SIGTERM', 129));

  serve.on('exit', (code, signal) => {
    log(`meowthd serve exited code=${code} signal=${signal}`);
    cleanupArtifacts();
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best effort
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  process.stderr.write(`[e2e-embed-fixture] ${(err as Error).message}\n`);
  cleanupArtifacts();
  process.exit(1);
});
