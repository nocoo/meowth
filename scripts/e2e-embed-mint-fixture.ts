#!/usr/bin/env tsx
/**
 * L3 embed-mint-fixture launcher.
 *
 * Boots a fresh meowthd via path B (`init --skip-token`) so the
 * first-run mint window is OPEN at serve time. Writes the
 * setup-code (mws_...) to OS-temp with mode 0600 so the
 * Playwright spec can paste it into the dashboard /setup mint
 * form. Same security posture as the token fixture: the file is
 * a secret, never logged, cleaned on graceful shutdown, and a
 * combined globalTeardown handles SIGKILL paths.
 *
 * Self-contained: runs `pnpm daemon:build` then `go build -o
 * scripts/run-l2-output/meowthd-embed-mint ./cmd/meowthd` so a
 * fresh checkout can boot without manual setup. Distinct binary
 * path so 3.22's `meowthd-embed` is not overwritten.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const DAEMON_DIR = join(REPO_ROOT, 'daemon');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts/run-l2-output');
const BINARY = join(OUTPUT_DIR, 'meowthd-embed-mint');
const CODE_FILE = join(tmpdir(), 'meowth-e2e-embed-mint-code');
const HOME_MARKER = join(tmpdir(), 'meowth-e2e-embed-mint-home-path');
const FIXED_PORT = 17778;

function log(msg: string): void {
  process.stdout.write(`[e2e-embed-mint-fixture] ${msg}\n`);
}

function cleanupArtifacts(): void {
  for (const f of [CODE_FILE, HOME_MARKER]) {
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

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const probe = createServer();
    probe.once('error', (err) => {
      rejectP(
        new Error(
          `port ${port} already in use (${(err as NodeJS.ErrnoException).code}); ` +
            'free it manually before re-running e2e:embed-mint',
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

  const home = mkdtempSync(join(tmpdir(), 'meowth-e2e-embed-mint-home-'));
  writeFileSync(HOME_MARKER, home, { encoding: 'utf8', mode: 0o600 });

  process.on('exit', () => {
    cleanupArtifacts();
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  log('meowthd init --skip-token (path B; mint window stays OPEN)');
  const initRes = spawnSync(BINARY, ['init', '--skip-token'], {
    env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (initRes.status !== 0) {
    // Do NOT echo stdout — first line is the mws_... setup-code.
    throw new Error(`meowthd init --skip-token status ${initRes.status}`);
  }
  const first = (initRes.stdout ?? '').split('\n', 2)[0]?.trim() ?? '';
  if (!first.startsWith('mws_')) {
    throw new Error('init --skip-token stdout did not start with mws_');
  }
  writeFileSync(CODE_FILE, first, { encoding: 'utf8', mode: 0o600 });
  log(`setup-code written to ${CODE_FILE} (0o600)`);

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
  // Don't echo stdout/stderr here either; err.message must not
  // include the setup-code.
  process.stderr.write(`[e2e-embed-mint-fixture] ${(err as Error).message}\n`);
  cleanupArtifacts();
  process.exit(1);
});
