#!/usr/bin/env node
/**
 * scripts/run-mint-l2.ts — Phase 3.8 L2 black-box for the first-run
 * mint endpoint per docs/architecture/04.
 *
 * The cases (chained into `pnpm test:l2`):
 *
 *   M1. path B happy: init --skip-token → spawn serve → POST
 *       /bootstrap/mint with captured setup-code → 201 + secret;
 *       the returned secret authenticates against GET /v1/tokens.
 *   M2. M1 second POST → 404; response carries no `secret` /
 *       `token_hash` / `salt`.
 *   M3. mode=ssh_tunnel: rewrite config.toml to a non-local mode
 *       AFTER init --skip-token; spawn serve; POST /bootstrap/mint
 *       → 404 (chi default NotFound for the unmounted route).
 *   M4. cross-process restart: same runHome, init --skip-token
 *       writes the nonce; spawn serve 3 times (start, stop, start,
 *       stop, start) without minting; the 4th spawn lets the
 *       caller mint with the original setup-code → 201.
 *   M5. mint-then-restart: complete M1 successfully; SIGTERM;
 *       spawn serve again; POST /bootstrap/mint → 404 (window not
 *       mounted because tokens table non-empty; stale cleanup ran
 *       on startup).
 *   M6. lockout: 5 wrong setup-codes → 6th correct → still 404.
 *
 * Credential hygiene: setup-codes and the returned secrets are
 * NEVER written to artifacts in full; only redacted prefixes
 * (`mws_XXXXX…` / `mwt_XXXXX…`) appear in the log.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { buildMeowthd } from './lib/build-meowthd';

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-mint-l2.log');

const PREFIX_LEN = 9;
let meowthdBinary = '';

const stdoutWrite = (m: string): void => {
  process.stdout.write(m);
};
const stderrWrite = (m: string): void => {
  process.stderr.write(m);
};

function log(line: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

function redact(s: string): string {
  if (!s) return '<empty>';
  return s.length >= PREFIX_LEN ? `${s.slice(0, PREFIX_LEN)}…` : '<redacted>';
}

function stripSecret(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(stripSecret);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === 'secret' || k === 'setup_code') {
      out[k] = '<redacted>';
      continue;
    }
    out[k] = stripSecret(v);
  }
  return out;
}

const testRootPreexisting = existsSync(TEST_ROOT);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  LOG_PATH,
  `# mint L2 matrix run\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
);

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

function mkRunHome(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  const rh = mkdtempSync(join(TEST_ROOT, 'mint-'));
  createdRunHomes.push(rh);
  return rh;
}

function initSkipToken(runHome: string): string {
  const r = execFileSync(meowthdBinary, ['init', '--skip-token'], {
    encoding: 'utf8',
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
  });
  const first = r.split(/\r?\n/)[0]?.trim() ?? '';
  if (!/^mws_[A-Z0-9]{39}$/.test(first)) {
    throw new Error(`init --skip-token first line not a setup-code (len=${String(first.length)})`);
  }
  return first;
}

function initPathA(runHome: string): string {
  const r = execFileSync(meowthdBinary, ['init'], {
    encoding: 'utf8',
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
  });
  const first = r.split(/\r?\n/)[0]?.trim() ?? '';
  return first;
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
  child: ChildProcess;
};

async function startServe(runHome: string): Promise<SuccessResult | FailResult> {
  const child = spawn(meowthdBinary, ['serve', '--listen-addr=127.0.0.1:0'], {
    env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.push(child);
  if (!child.stdout || !child.stderr) {
    throw new Error('serve child missing stdout/stderr');
  }
  let stdoutBuf = '';
  let stderrBuf = '';
  const stderrStream = createWriteStream(join(OUTPUT_DIR, 'serve.stderr.log'), { flags: 'a' });
  const stdoutStream = createWriteStream(join(OUTPUT_DIR, 'serve.stdout.log'), { flags: 'a' });
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
  const timedOut = delay(20_000, undefined, { ref: false }).then(() => ({
    kind: 'timeout' as const,
  }));
  const winner = await Promise.race([listening, exited, timedOut]);

  if (winner.kind === 'listening') {
    return { kind: 'success', addr: winner.addr, child };
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
  return {
    kind: 'fail',
    exitCode: winner.kind === 'exited' ? (winner.code ?? -1) : -1,
    stdout: stdoutBuf,
    stderr: stderrBuf,
  };
}

async function stopServe(child: ChildProcess): Promise<void> {
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

type ResponseBundle = { status: number; body: unknown; headers: Headers };

async function jsonReq(
  base: string,
  method: string,
  path: string,
  opts: { bearer?: string; body?: unknown } = {},
): Promise<ResponseBundle> {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  let bodyInit: string | undefined;
  if (opts.body !== undefined) {
    bodyInit = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(`${base}${path}`, { method, headers, body: bodyInit });
  const text = await r.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      // leave as text
    }
  }
  return { status: r.status, body, headers: r.headers };
}

function expectNosniff(r: ResponseBundle, label: string): void {
  const v = r.headers.get('x-content-type-options');
  if (v !== 'nosniff') {
    throw new Error(`${label}: X-Content-Type-Options = ${v ?? '<missing>'}; want nosniff`);
  }
  for (const k of [
    'content-security-policy',
    'referrer-policy',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy',
    'permissions-policy',
  ]) {
    if (r.headers.get(k) !== null) {
      throw new Error(`${label}: response leaked HTML-document header ${k}`);
    }
  }
}

async function pollHealthz(base: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await jsonReq(base, 'GET', '/healthz');
      if (r.status === 200 && (r.body as Record<string, unknown>).ok === true) return;
    } catch {
      // not ready
    }
    await delay(200);
  }
  throw new Error('/healthz did not return 200 ok=true within 10s');
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  stdoutWrite(`L2/MINT ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    await fn();
    log(`OK   ${label}`);
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2/MINT ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

function assertNoSecretLeak(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const inspect = (val: unknown): void => {
    if (val === null || typeof val !== 'object') return;
    if (Array.isArray(val)) {
      for (const v of val) inspect(v);
      return;
    }
    for (const k of ['secret', 'token_hash', 'salt']) {
      if (k in (val as Record<string, unknown>)) {
        throw new Error(`response leaked field ${k}: ${JSON.stringify(stripSecret(body))}`);
      }
    }
    for (const v of Object.values(val as Record<string, unknown>)) inspect(v);
  };
  inspect(body);
}

function rewriteConfigToSSHTunnel(runHome: string): void {
  const cfg = `# rewritten by run-mint-l2.ts case M3
[remote_access]
mode            = "ssh_tunnel"
bind_addr       = "127.0.0.1"
bind_port       = 7040
acknowledged_by = "mint-l2"
`;
  writeFileSync(join(runHome, 'config.toml'), cfg, { mode: 0o600 });
}

async function main(): Promise<void> {
  // Build daemon binary once and exec it directly (no `go run`
  // wrapper) so Kill() reaches the actual meowthd process.
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });
  meowthdBinary = buildMeowthd('meowthd-mint-l2');

  // ---------- M1 + M2 ----------
  await step('M1+M2 path B happy + replay = 404 (no secret leak)', async () => {
    const rh = mkRunHome();
    const setupCode = initSkipToken(rh);
    log(`setupCode=${redact(setupCode)}`);
    const r = await startServe(rh);
    if (r.kind !== 'success') throw new Error(`serve failed: ${r.stderr}`);
    try {
      await pollHealthz(`http://${r.addr}`);
      // M1 — mint succeeds
      const mint1 = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: setupCode },
      });
      if (mint1.status !== 201) {
        throw new Error(
          `M1 mint status=${mint1.status} body=${JSON.stringify(stripSecret(mint1.body))}`,
        );
      }
      expectNosniff(mint1, 'M1 /bootstrap/mint 201');
      const minted = mint1.body as {
        id?: string;
        secret?: string;
        prefix?: string;
        created_via?: string;
      };
      if (!minted.secret || !minted.secret.startsWith('mwt_') || minted.secret.length !== 43) {
        throw new Error('M1 secret missing or malformed');
      }
      if (minted.prefix !== minted.secret.slice(0, PREFIX_LEN)) {
        throw new Error(`M1 prefix ${minted.prefix ?? ''} != secret prefix`);
      }
      if (minted.created_via !== 'first_run_mint') {
        throw new Error(`M1 created_via = ${minted.created_via ?? '<empty>'}`);
      }
      log(`mintedSecret=${redact(minted.secret)} mintedID=${minted.id ?? ''}`);

      // Bearer works against /v1/tokens
      const list = await jsonReq(`http://${r.addr}`, 'GET', '/v1/tokens', {
        bearer: minted.secret,
      });
      if (list.status !== 200) {
        throw new Error(`/v1/tokens with new bearer: status=${list.status}`);
      }
      expectNosniff(list, 'M1 /v1/tokens 200');
      assertNoSecretLeak(list.body);

      // M2 — replay returns 404 + no secret
      const mint2 = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: setupCode },
      });
      if (mint2.status !== 404) {
        throw new Error(`M2 replay status=${mint2.status}, want 404`);
      }
      expectNosniff(mint2, 'M2 /bootstrap/mint 404 (replay)');
      assertNoSecretLeak(mint2.body);
    } finally {
      await stopServe(r.child);
    }
  });

  // ---------- M3 ----------
  await step('M3 mode=ssh_tunnel → mint not mounted (404)', async () => {
    const rh = mkRunHome();
    initSkipToken(rh);
    rewriteConfigToSSHTunnel(rh);
    const r = await startServe(rh);
    if (r.kind !== 'success') throw new Error(`serve failed: ${r.stderr}`);
    try {
      await pollHealthz(`http://${r.addr}`);
      const mint = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: 'mws_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      });
      if (mint.status !== 404) {
        throw new Error(`M3 status=${mint.status}, want 404`);
      }
      expectNosniff(mint, 'M3 /bootstrap/mint 404 (unmounted)');
      assertNoSecretLeak(mint.body);
    } finally {
      await stopServe(r.child);
    }
  });

  // ---------- M4 ----------
  await step('M4 cross-process restart (≥3 cycles) → same setup-code still mints', async () => {
    const rh = mkRunHome();
    const setupCode = initSkipToken(rh);
    log(`M4 setupCode=${redact(setupCode)}`);
    // Cycle the daemon 3 times without minting.
    for (let i = 0; i < 3; i++) {
      const r = await startServe(rh);
      if (r.kind !== 'success') throw new Error(`M4 cycle ${i}: serve failed: ${r.stderr}`);
      await pollHealthz(`http://${r.addr}`);
      await stopServe(r.child);
    }
    // 4th cycle: mint must still succeed.
    const r = await startServe(rh);
    if (r.kind !== 'success') throw new Error(`M4 final cycle serve failed: ${r.stderr}`);
    try {
      await pollHealthz(`http://${r.addr}`);
      const mint = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: setupCode },
      });
      if (mint.status !== 201) {
        throw new Error(`M4 mint status=${mint.status}, want 201`);
      }
      const minted = mint.body as { secret?: string };
      if (!minted.secret || !minted.secret.startsWith('mwt_')) {
        throw new Error('M4 minted secret missing/malformed');
      }
    } finally {
      await stopServe(r.child);
    }
  });

  // ---------- M5 ----------
  await step('M5 successful mint → restart → /bootstrap/mint 404 (window closed)', async () => {
    const rh = mkRunHome();
    const setupCode = initSkipToken(rh);
    {
      const r = await startServe(rh);
      if (r.kind !== 'success') throw new Error(`M5 first serve failed: ${r.stderr}`);
      try {
        await pollHealthz(`http://${r.addr}`);
        const mint = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
          body: { setup_code: setupCode },
        });
        if (mint.status !== 201) throw new Error(`M5 first mint status=${mint.status}`);
      } finally {
        await stopServe(r.child);
      }
    }
    // Restart and confirm endpoint is unmounted (chi default 404).
    const r2 = await startServe(rh);
    if (r2.kind !== 'success') throw new Error(`M5 restart serve failed: ${r2.stderr}`);
    try {
      await pollHealthz(`http://${r2.addr}`);
      const mint = await jsonReq(`http://${r2.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: setupCode },
      });
      if (mint.status !== 404) {
        throw new Error(`M5 post-restart mint status=${mint.status}, want 404`);
      }
      assertNoSecretLeak(mint.body);
      // stale cleanup ran on restart: setup_nonce.hash should be gone
      const noncePath = join(rh, 'runtime', 'setup_nonce.hash');
      if (existsSync(noncePath)) {
        throw new Error('M5 stale setup_nonce.hash not cleaned on restart');
      }
    } finally {
      await stopServe(r2.child);
    }
  });

  // ---------- M6 ----------
  await step('M6 lockout: 5 wrong + 6th correct → 404 (no secret)', async () => {
    const rh = mkRunHome();
    const setupCode = initSkipToken(rh);
    const r = await startServe(rh);
    if (r.kind !== 'success') throw new Error(`M6 serve failed: ${r.stderr}`);
    try {
      await pollHealthz(`http://${r.addr}`);
      const wrong = 'mws_' + 'B'.repeat(39);
      for (let i = 0; i < 5; i++) {
        const m = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
          body: { setup_code: wrong },
        });
        if (m.status !== 404) throw new Error(`M6 wrong[${i}] status=${m.status}`);
      }
      const final = await jsonReq(`http://${r.addr}`, 'POST', '/bootstrap/mint', {
        body: { setup_code: setupCode },
      });
      if (final.status !== 404) {
        throw new Error(`M6 post-lockout correct code: status=${final.status}, want 404`);
      }
      assertNoSecretLeak(final.body);
    } finally {
      await stopServe(r.child);
    }
  });

  // Sanity: artifacts must not have leaked a full mwt_/mws_ literal.
  const logBody = readFileSync(LOG_PATH, 'utf8');
  if (/mwt_[A-Z0-9]{20,}/.test(logBody) || /mws_[A-Z0-9]{20,}/.test(logBody)) {
    throw new Error('run-mint-l2.log leaked a full token/setup-code');
  }

  stdoutWrite('L2/MINT: OK (6 cases)\n');
  log('DONE OK');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2/MINT fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
