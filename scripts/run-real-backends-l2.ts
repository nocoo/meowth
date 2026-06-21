#!/usr/bin/env node
/**
 * scripts/run-real-backends-l2.ts — Phase 3.12 opt-in L2 harness.
 *
 * Exercises each of the 5 backend types (claude / copilot / codex /
 * hermes / pi) against the production agentfactory. The default
 * `pnpm test:l2` chain does NOT include this script; CI runners
 * without the real CLIs installed can keep passing.
 *
 * Gate (per docs/architecture/01 §8 + reviewer correction #2):
 *   - MEOWTH_REAL_BACKENDS_L2=1 — required to opt in. Without it,
 *     this harness prints a skip notice and exits 0.
 *   - For each backend, if the CLI is not on PATH the case is
 *     skipped (informational; not a failure).
 *   - If the CLI is on PATH and the case fires, we REQUIRE
 *     session_ended.status == "completed" AND at least one
 *     user-visible message envelope. Installed-but-broken
 *     (unauthenticated, missing API key, etc.) fails the case so
 *     the operator notices.
 *
 * The harness spawns its own `meowthd serve` in production mode
 * (MEOWTH_BACKEND_FACTORY unset / "production") against an
 * isolated test home with a fresh root token. SIGTERM cleanup
 * happens between cases so one backend's failure does not poison
 * the next.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const SUPPORTED_TYPES = ['claude', 'copilot', 'codex', 'hermes', 'pi'] as const;
type BackendType = (typeof SUPPORTED_TYPES)[number];

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-real-backends-l2.log');

const meowthd = join(REPO_ROOT, 'daemon', 'cmd', 'meowthd');

const stdoutWrite = (m: string): void => {
  process.stdout.write(m);
};
const stderrWrite = (m: string): void => {
  process.stderr.write(m);
};

function log(line: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

// Gate: require the env flag to opt in.
if (process.env.MEOWTH_REAL_BACKENDS_L2 !== '1') {
  stdoutWrite(
    'L2/REAL ⊘ skipped (set MEOWTH_REAL_BACKENDS_L2=1 to run against installed CLIs)\n',
  );
  process.exit(0);
}

const testRootPreexisting = existsSync(TEST_ROOT);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  LOG_PATH,
  `# real-backends L2 run\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
);

const liveChildren: ChildProcess[] = [];
const createdRunHomes: string[] = [];

function cleanup(): void {
  for (const c of liveChildren) {
    try {
      if (c.pid && c.exitCode === null) c.kill('SIGKILL');
    } catch {
      // best-effort
    }
  }
  for (const rh of createdRunHomes) {
    try {
      if (existsSync(rh)) rmSync(rh, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  if (!testRootPreexisting && existsSync(TEST_ROOT)) {
    try {
      rmdirSync(TEST_ROOT);
    } catch {
      // non-empty
    }
  }
}
process.on('exit', cleanup);

function isInstalled(type: BackendType): boolean {
  // exec.LookPath analogue: search PATH for the binary, treat
  // any non-empty resolved path as "installed".
  try {
    const out = execFileSync('which', [type], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function mkRunHome(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  const rh = mkdtempSync(join(TEST_ROOT, 'real-'));
  createdRunHomes.push(rh);
  return rh;
}

function initRootBearer(runHome: string): string {
  const out = execFileSync('go', ['run', meowthd, 'init'], {
    cwd: join(REPO_ROOT, 'daemon'),
    encoding: 'utf8',
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
  });
  const first = out.split(/\r?\n/)[0]?.trim() ?? '';
  if (!/^mwt_[A-Za-z0-9]{39}$/.test(first)) {
    throw new Error('init stdout missing token');
  }
  return first;
}

async function spawnServe(runHome: string): Promise<{ child: ChildProcess; addr: string }> {
  // Production factory: do NOT set MEOWTH_BACKEND_FACTORY=fake;
  // MEOWTH_TEST=1 only switches the home root.
  const child = spawn('go', ['run', meowthd, 'serve', '--listen-addr=127.0.0.1:0'], {
    cwd: join(REPO_ROOT, 'daemon'),
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.push(child);
  if (!child.stdout || !child.stderr) throw new Error('serve missing stdio');
  child.stderr.pipe(createWriteStream(join(OUTPUT_DIR, 'real-backends.stderr.log'), { flags: 'a' }));
  child.stdout.pipe(createWriteStream(join(OUTPUT_DIR, 'real-backends.stdout.log'), { flags: 'a' }));
  const rl = createInterface({ input: child.stdout });
  const deadline = delay(15_000).then(() => {
    throw new Error('timeout waiting for listening line');
  });
  const lineP = (async () => {
    for await (const line of rl) {
      const m = /^listening:\s*(\S+)$/.exec(line);
      if (m) return m[1] ?? '';
    }
    throw new Error('stdout closed before listening');
  })();
  const addr = await Promise.race([lineP, deadline]);
  return { child, addr };
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exit = once(child, 'exit');
  const timeout = delay(8_000).then(() => 'timeout' as const);
  const winner = await Promise.race([exit, timeout]);
  if (winner === 'timeout') {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function pollHealthz(base: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.status === 200) {
        const body = (await r.json()) as { ok?: boolean };
        if (body.ok === true) return;
      }
    } catch {
      // not ready
    }
    await delay(200);
  }
  throw new Error('/healthz never ready');
}

async function execAgent(
  base: string,
  bearer: string,
  type: BackendType,
  prompt: string,
): Promise<{ status: number; events: Array<Record<string, unknown>> }> {
  const r = await fetch(`${base}/v1/agents/${type}/exec`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeout_ms: 30_000 }),
  });
  const text = await r.text();
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore non-JSON noise
    }
  }
  return { status: r.status, events };
}

const summary: Array<{ type: BackendType; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
let failureCount = 0;

async function runForType(type: BackendType): Promise<void> {
  stdoutWrite(`L2/REAL ▸ ${type}\n`);
  log(`STEP ${type}`);

  if (!isInstalled(type)) {
    stdoutWrite(`L2/REAL ⊘ ${type} skipped (binary not on PATH)\n`);
    summary.push({ type, status: 'skip', detail: 'binary not on PATH' });
    log(`SKIP ${type}: binary not on PATH`);
    return;
  }

  const runHome = mkRunHome();
  let child: ChildProcess | null = null;
  try {
    const bearer = initRootBearer(runHome);
    const spawned = await spawnServe(runHome);
    child = spawned.child;
    const base = `http://${spawned.addr}`;
    await pollHealthz(base);

    const r = await execAgent(base, bearer, type, 'What is 2+2? Reply with just the number.');
    if (r.status !== 200) {
      throw new Error(`HTTP ${r.status}`);
    }
    const lastEvent = r.events[r.events.length - 1] as
      | { type: string; payload: { status: string; error?: string } }
      | undefined;
    if (!lastEvent || lastEvent.type !== 'session_ended') {
      throw new Error(`last event not session_ended: ${JSON.stringify(lastEvent ?? {})}`);
    }
    if (lastEvent.payload.status !== 'completed') {
      throw new Error(
        `final status = ${lastEvent.payload.status} (error=${lastEvent.payload.error ?? ''}); installed-but-broken`,
      );
    }
    const hasUserVisibleMessage = r.events.some((e) => {
      if (e.type !== 'message') return false;
      const payload = e.payload as { kind?: string; content?: string };
      // Any non-empty text or tool-use/result is acceptable
      return Boolean(payload.kind && payload.content);
    });
    if (!hasUserVisibleMessage) {
      throw new Error('no user-visible message envelope received');
    }
    stdoutWrite(`L2/REAL ✓ ${type} completed\n`);
    summary.push({ type, status: 'pass', detail: 'completed with user-visible message' });
    log(`PASS ${type}`);
  } catch (err) {
    failureCount++;
    stderrWrite(`L2/REAL ✘ ${type}: ${String(err)}\n`);
    summary.push({ type, status: 'fail', detail: String(err) });
    log(`FAIL ${type}: ${String(err)}`);
  } finally {
    if (child) await killChild(child);
  }
}

async function main(): Promise<void> {
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });
  for (const type of SUPPORTED_TYPES) {
    await runForType(type);
  }
  stdoutWrite('L2/REAL summary:\n');
  for (const s of summary) {
    stdoutWrite(`  ${s.type.padEnd(8)} ${s.status.padEnd(6)} ${s.detail}\n`);
  }
  if (failureCount > 0) {
    stderrWrite(`L2/REAL: ${failureCount} failure(s)\n`);
    process.exit(1);
  }
  stdoutWrite('L2/REAL: OK\n');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2/REAL fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
