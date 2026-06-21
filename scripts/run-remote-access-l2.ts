#!/usr/bin/env node
/**
 * scripts/run-remote-access-l2.ts — Phase 3.9 L2 startup matrix.
 *
 * For each fixture case, builds a fresh isolated runHome under the
 * D1 test root, writes (or skips) a hand-rolled config.toml with
 * the docs/architecture/05 §6.2 trigger, runs `meowthd serve`, and
 * asserts the success / failure shape of stdout+stderr+exit.
 *
 * Cases (per reviewer):
 *   1.  block-missing       → serve starts, /healthz 200
 *   2.  explicit-local + --listen-addr=127.0.0.1:0 → serve starts
 *   3.  D0 missing bind_port → exit 1, stderr "D0", runHome empty
 *   4.  D1 bad mode
 *   5.  D2 ack empty (tailscale)
 *   6.  D3 wildcard
 *   7.  D3 has_port
 *   8.  D4 bad port
 *   9.  D5 mode/bind mismatch (tailscale + 127.0.0.1)
 *   10. D6 (informational only — L1-covered per reviewer; black-box
 *       can't inject net.InterfaceAddrs without forging a Tailscale
 *       environment)
 *
 * Case 3 is the canonical "validation failure must not touch DB"
 * assertion: after the failed serve, the runHome must NOT contain
 * `meowth-test.db` or any `_test_marker` artefact. Validation runs
 * before h.Ensure() / store.Open() so this is a literal contract.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-remote-access-l2.log');

const stdoutWrite = (m: string): void => {
  process.stdout.write(m);
};
const stderrWrite = (m: string): void => {
  process.stderr.write(m);
};

function log(line: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

const testRootPreexisting = existsSync(TEST_ROOT);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(LOG_PATH, `# remote_access L2 matrix run\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`);

const createdRunHomes: string[] = [];
const liveChildren: ChildProcess[] = [];

function cleanup(): void {
  for (const child of liveChildren) {
    try {
      if (child.pid && child.exitCode === null) child.kill('SIGKILL');
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
      // non-empty; leave alone.
    }
  }
}
process.on('exit', cleanup);

const meowthd = join(REPO_ROOT, 'daemon', 'cmd', 'meowthd');

function mkRunHome(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  const rh = mkdtempSync(join(TEST_ROOT, 'ra-'));
  createdRunHomes.push(rh);
  return rh;
}

function writeConfig(runHome: string, body: string): void {
  writeFileSync(join(runHome, 'config.toml'), body, { mode: 0o600 });
}

// seedInitializedHome runs `meowthd init` so the DB / marker are
// present, then overwrites config.toml with `body` so the next
// `serve` consumes our fixture. Used for success cases where the
// daemon must actually start; failure cases skip this and rely
// on validation refusing to touch the store.
function seedInitializedHome(runHome: string, body: string): void {
  execFileSync('go', ['run', meowthd, 'init'], {
    cwd: join(REPO_ROOT, 'daemon'),
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
    stdio: 'pipe',
  });
  writeConfig(runHome, body);
}

type FailResult = {
  kind: 'fail';
  exitCode: number;
  stdout: string;
  stderr: string;
};
type SuccessResult = {
  kind: 'success';
  addr: string;
  stdoutSoFar: string;
  child: ChildProcess;
};

// runServe spawns `meowthd serve` and races a one-shot reader of
// the child's stdout for `listening:` line. On success it returns
// the address + the still-running child (caller is expected to
// terminate). On failure (non-zero exit before listening), it
// returns the captured streams and exit code.
async function runServe(
  runHome: string,
  extraArgs: string[] = [],
): Promise<FailResult | SuccessResult> {
  const child = spawn('go', ['run', meowthd, 'serve', ...extraArgs], {
    cwd: join(REPO_ROOT, 'daemon'),
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.push(child);
  if (!child.stdout || !child.stderr) {
    throw new Error('serve child missing stdout/stderr');
  }

  let stdoutBuf = '';
  let stderrBuf = '';
  const stdoutStream = createWriteStream(join(OUTPUT_DIR, 'serve.stdout.log'), { flags: 'a' });
  const stderrStream = createWriteStream(join(OUTPUT_DIR, 'serve.stderr.log'), { flags: 'a' });
  child.stdout.on('data', (b: Buffer) => {
    stdoutBuf += b.toString('utf8');
    stdoutStream.write(b);
  });
  child.stderr.on('data', (b: Buffer) => {
    stderrBuf += b.toString('utf8');
    stderrStream.write(b);
  });

  const rl = createInterface({ input: child.stdout });
  const listening = (async () => {
    for await (const line of rl) {
      const m = /^listening:\s*(\S+)$/.exec(line);
      if (m) {
        rl.close();
        return { kind: 'listening' as const, addr: m[1] ?? '' };
      }
    }
    return { kind: 'closed' as const };
  })();
  const exited = (once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>).then(
    ([code]) => ({ kind: 'exited' as const, code }),
  );
  const timedOut = delay(15_000, undefined, { ref: false }).then(() => ({ kind: 'timeout' as const }));

  const winner = await Promise.race([listening, exited, timedOut]);

  if (winner.kind === 'listening') {
    return {
      kind: 'success',
      addr: winner.addr,
      stdoutSoFar: stdoutBuf,
      child,
    };
  }

  if (winner.kind === 'timeout') {
    try {
      child.kill('SIGKILL');
    } catch {
      // best-effort
    }
    await once(child, 'exit');
    return { kind: 'fail', exitCode: -1, stdout: stdoutBuf, stderr: stderrBuf };
  }

  if (winner.kind === 'exited') {
    return { kind: 'fail', exitCode: winner.code ?? -1, stdout: stdoutBuf, stderr: stderrBuf };
  }

  // listening's iterator closed without a match
  await once(child, 'exit');
  return { kind: 'fail', exitCode: child.exitCode ?? -1, stdout: stdoutBuf, stderr: stderrBuf };
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exit = once(child, 'exit');
  const timeout = delay(5_000, undefined, { ref: false });
  const winner = await Promise.race([exit, timeout.then(() => 'timeout' as const)]);
  if (winner === 'timeout') {
    try {
      child.kill('SIGKILL');
    } catch {
      // best-effort
    }
    await once(child, 'exit');
  }
}

async function fetchOK(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (r.status !== 200) return false;
    const j = (await r.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

async function assertHealthz(addr: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await fetchOK(`http://${addr}/healthz`)) return;
    await delay(150);
  }
  throw new Error(`/healthz did not become healthy at ${addr}`);
}

type Case = {
  label: string;
  build: () => Promise<void>;
  expectSuccess: boolean;
  successKill?: boolean;
};

const cases: Case[] = [];
let passes = 0;

function pushCase(c: Case): void {
  cases.push(c);
}

// Case 1 — block missing → default local + healthz.
pushCase({
  label: 'block-missing → default local + healthz 200',
  expectSuccess: true,
  successKill: true,
  build: async () => {
    const rh = mkRunHome();
    seedInitializedHome(rh, '# no [remote_access] block\n');
    const r = await runServe(rh, ['--listen-addr=127.0.0.1:0']);
    if (r.kind !== 'success') throw new Error(`expected success, got fail (code=${r.exitCode}); stderr=${r.stderr}`);
    await assertHealthz(r.addr);
    await killChild(r.child);
  },
});

// Case 2 — explicit local + override → healthz.
pushCase({
  label: 'explicit local + --listen-addr=127.0.0.1:0 → healthz 200',
  expectSuccess: true,
  successKill: true,
  build: async () => {
    const rh = mkRunHome();
    seedInitializedHome(
      rh,
      `[remote_access]
mode            = "local"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = ""
`,
    );
    const r = await runServe(rh, ['--listen-addr=127.0.0.1:0']);
    if (r.kind !== 'success') throw new Error(`expected success, got fail (code=${r.exitCode}); stderr=${r.stderr}`);
    await assertHealthz(r.addr);
    await killChild(r.child);
  },
});

// Helper for D-code failures: writes the given config, asserts
// serve exits non-zero and that the stderr contains the wanted
// code marker.
function failureCase(label: string, body: string, want: { code: string; fragment?: string }, args: string[] = []): Case {
  return {
    label,
    expectSuccess: false,
    build: async () => {
      const rh = mkRunHome();
      writeConfig(rh, body);
      const r = await runServe(rh, args);
      if (r.kind !== 'fail') {
        await killChild(r.child);
        throw new Error(`expected failure, got success at ${r.addr}`);
      }
      if (r.exitCode === 0) throw new Error(`exit code 0; expected non-zero`);
      if (!r.stderr.includes(want.code)) {
        throw new Error(`stderr lacks ${want.code} marker:\n${r.stderr}`);
      }
      if (want.fragment && !r.stderr.includes(want.fragment)) {
        throw new Error(`stderr lacks fragment ${want.fragment}:\n${r.stderr}`);
      }
    },
  };
}

// Case 3 — D0 + DB-not-created assertion.
pushCase({
  label: 'D0 missing bind_port → exit 1 + no DB / marker created',
  expectSuccess: false,
  build: async () => {
    const rh = mkRunHome();
    writeConfig(
      rh,
      `[remote_access]
mode      = "local"
bind_addr = "127.0.0.1"
`,
    );
    const r = await runServe(rh);
    if (r.kind !== 'fail') {
      await killChild(r.child);
      throw new Error(`expected failure, got success at ${r.addr}`);
    }
    if (r.exitCode === 0) throw new Error(`exit code 0; expected non-zero`);
    if (!r.stderr.includes('D0')) throw new Error(`stderr lacks D0 marker:\n${r.stderr}`);
    // Reviewer's "validation precedes DB" assertion: only the
    // hand-written config.toml may live in runHome at this point.
    const remaining = readdirSync(rh);
    const forbidden = remaining.filter((n) => n !== 'config.toml');
    if (forbidden.length > 0) {
      throw new Error(
        `runHome should contain ONLY config.toml after a D0 failure; found: ${forbidden.join(', ')}`,
      );
    }
  },
});

// Case 4 — D1 bad mode.
pushCase(
  failureCase(
    'D1 bad mode → exit 1',
    `[remote_access]
mode            = "lan"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = ""
`,
    { code: 'D1', fragment: 'not a valid enum value' },
  ),
);

// Case 5 — D2 ack empty (tailscale).
pushCase(
  failureCase(
    'D2 missing acknowledged_by → exit 1',
    `[remote_access]
mode            = "tailscale"
bind_addr       = "100.64.10.20"
bind_port       = 7777
acknowledged_by = ""
`,
    { code: 'D2', fragment: 'acknowledged_by is empty' },
  ),
);

// Case 6 — D3 wildcard.
pushCase(
  failureCase(
    'D3 wildcard bind_addr → exit 1',
    `[remote_access]
mode            = "local"
bind_addr       = "0.0.0.0"
bind_port       = 7777
acknowledged_by = ""
`,
    { code: 'D3', fragment: 'wildcard' },
  ),
);

// Case 7 — D3 has_port.
pushCase(
  failureCase(
    'D3 bind_addr with port → exit 1',
    `[remote_access]
mode            = "local"
bind_addr       = "127.0.0.1:7777"
bind_port       = 7777
acknowledged_by = ""
`,
    { code: 'D3', fragment: 'has_port' },
  ),
);

// Case 8 — D4 bad port.
pushCase(
  failureCase(
    'D4 bad port → exit 1',
    `[remote_access]
mode            = "local"
bind_addr       = "127.0.0.1"
bind_port       = 70000
acknowledged_by = ""
`,
    { code: 'D4', fragment: 'out of range' },
  ),
);

// Case 9 — D5 mode/bind mismatch.
pushCase(
  failureCase(
    'D5 tailscale + loopback bind_addr → exit 1',
    `[remote_access]
mode            = "tailscale"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = "l2-canary"
`,
    { code: 'D5', fragment: 'tailscale must bind your Tailscale IP' },
  ),
);

// Case 10 — D6 black-box-non-coverable; informational only.

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  stdoutWrite(`L2/RA ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    await fn();
    log(`OK   ${label}`);
    passes++;
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2/RA ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Build daemon binary once so each case's spawn() reuses the
  // cached compile. Not strictly required (go run handles it) but
  // avoids serialising 8 separate go-build runs on cold module
  // caches.
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });

  for (const c of cases) {
    await step(c.label, c.build);
  }
  stdoutWrite(`L2/RA ⊘ D6 covered in L1 only (black-box cannot inject net.InterfaceAddrs without a real Tailscale environment)\n`);

  stdoutWrite(`L2/RA: OK (${String(passes)} cases)\n`);
  log('DONE OK');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2/RA fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
