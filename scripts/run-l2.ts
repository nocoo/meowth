#!/usr/bin/env node
/**
 * scripts/run-l2.ts — L2 black-box harness for the meowth daemon.
 *
 * What this does
 * - Provisions an isolated test home under the D1 test root.
 * - Builds the daemon binary (`pnpm daemon:build`).
 * - Runs `meowthd init` (path A) against that home to mint a root
 *   token and seed the SQLite DB + marker; captures the first stdout
 *   line as the root bearer.
 * - Spawns `meowthd serve --listen-addr=127.0.0.1:0` against the same
 *   home; reads the `listening: host:port` line from its stdout.
 * - Polls `GET /healthz` until it returns 200 `{"ok":true}`.
 * - Exercises `GET /v1/tokens` without bearer (expect 401), with the
 *   root bearer (expect 200 + array of TokenView; never carries
 *   `secret` / `token_hash` / `salt`).
 * - `POST /v1/tokens` to mint a secondary token (`l2-canary`);
 *   expects 201 + `{id, secret, prefix, ...}`.
 * - `DELETE /v1/tokens/{secondary-id}` with the root bearer; expects
 *   200 + `{id, revoked_at}` (no secret/hash/salt leakage).
 * - Re-uses the secondary token's secret to `GET /v1/tokens`; expects
 *   401 (the bearer is revoked). Uses root again afterwards to
 *   verify the daemon is still healthy and the list still excludes
 *   secrets.
 * - SIGTERM the child, wait for exit (5s), SIGKILL on timeout.
 * - Cleans up only the per-run dir; never deletes the D1 test root
 *   or anything under the user's real `$HOME/.meowth/`.
 *
 * Credential hygiene
 * - The root bearer and the secondary `secret` are NEVER written to
 *   the harness log or stderr in full. Only the redacted 9-char
 *   prefix or the placeholder `<redacted>` appear in artifacts.
 *   Failure dumps strip `secret` from POST response bodies.
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
import { buildMeowthd } from './lib/build-meowthd';

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-l2.log');
const SERVE_STDERR = join(OUTPUT_DIR, 'serve.stderr.log');
const SERVE_STDOUT = join(OUTPUT_DIR, 'serve.stdout.log');

// docs/architecture/03 §3: secrets are "mwt_" + 5 base32 chars indexed.
const PREFIX_LEN = 9;

const stdoutWrite = (msg: string): void => {
  process.stdout.write(msg);
};
const stderrWrite = (msg: string): void => {
  process.stderr.write(msg);
};

function log(line: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

// redact a bearer-shaped secret to its 9-char indexed prefix.
function redactBearer(s: string): string {
  if (!s) return '<empty>';
  return s.length >= PREFIX_LEN ? `${s.slice(0, PREFIX_LEN)}…` : '<redacted>';
}

// stripSecret returns a defensive copy of a response body suitable for
// log artifacts. Removes `secret` and any other one-shot fields.
function stripSecret(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(stripSecret);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === 'secret') {
      out[k] = '<redacted>';
      continue;
    }
    out[k] = stripSecret(v);
  }
  return out;
}

async function step(label: string, fn: () => void | Promise<void>): Promise<void> {
  stdoutWrite(`L2 ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    await fn();
    log(`OK   ${label}`);
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2 ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

const testRootPreexisting = existsSync(TEST_ROOT);

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  LOG_PATH,
  `# L2 harness run\n# repo: ${REPO_ROOT}\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
);
writeFileSync(SERVE_STDERR, '');
writeFileSync(SERVE_STDOUT, '');

let runHome = '';
let serveChild: ChildProcess | null = null;
let serveExited = false;

function cleanup(): void {
  // Kill leftover serve child first so it cannot hold open file
  // handles inside runHome while we rmSync.
  if (serveChild && serveChild.pid && !serveExited) {
    try {
      serveChild.kill('SIGKILL');
    } catch {
      // best-effort
    }
  }
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
      // non-empty; leave alone.
    }
  }
}
process.on('exit', cleanup);

let meowthdBinary = '';

type FetchResult = { status: number; body: unknown; headers: Headers };

async function jsonRequest(
  base: string,
  method: string,
  path: string,
  opts: { bearer?: string; body?: unknown } = {},
): Promise<FetchResult> {
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

// expectNosniff asserts docs/architecture/07 §4.1 C — every response
// carries `X-Content-Type-Options: nosniff` exactly once. Also
// rejects accidentally-leaked HTML-document headers from
// docs/architecture/07 §4.2 on API / problem responses.
function expectNosniff(r: FetchResult, label: string): void {
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
      throw new Error(`${label}: API response leaked HTML-document header ${k}`);
    }
  }
}

function dumpResponse(label: string, r: FetchResult): string {
  return `${label}: status=${r.status} body=${JSON.stringify(stripSecret(r.body))}`;
}

let baseURL = '';
let rootBearer = '';
let secondaryBearer = '';
let secondaryID = '';

async function main(): Promise<void> {
  await step('prepare D1 test root and per-run dir', () => {
    mkdirSync(TEST_ROOT, { recursive: true });
    runHome = mkdtempSync(join(TEST_ROOT, 'run-'));
    log(`runHome=${runHome}`);
  });

  await step('build daemon binary', () => {
    execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });
    meowthdBinary = buildMeowthd('meowthd-l2');
  });

  await step('meowthd init (path A) seeds DB + root token', () => {
    const r = execFileSync(meowthdBinary, ['init'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MEOWTH_TEST: '1',
        MEOWTH_TEST_HOME: runHome,
      },
    });
    const firstLine = r.split(/\r?\n/)[0]?.trim() ?? '';
    if (!/^mwt_[A-Za-z0-9]+$/.test(firstLine) || firstLine.length !== 43) {
      throw new Error(
        `init stdout first line did not match a token pattern: <redacted, length=${String(firstLine.length)}>`,
      );
    }
    rootBearer = firstLine;
    log(`rootBearer=${redactBearer(rootBearer)}`);
  });

  await step('spawn meowthd serve --listen-addr=127.0.0.1:0', async () => {
    serveChild = spawn(meowthdBinary, ['serve', '--listen-addr=127.0.0.1:0'], {
      env: {
        ...process.env,
        MEOWTH_TEST: '1',
        MEOWTH_TEST_HOME: runHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!serveChild.stdout || !serveChild.stderr) {
      throw new Error('serve child missing stdout/stderr');
    }
    const stderrStream = createWriteStream(SERVE_STDERR);
    serveChild.stderr.pipe(stderrStream);
    const stdoutStream = createWriteStream(SERVE_STDOUT);
    serveChild.stdout.pipe(stdoutStream);
    serveChild.on('exit', (code, sig) => {
      serveExited = true;
      log(`serve exit code=${String(code)} sig=${String(sig)}`);
    });

    const rl = createInterface({ input: serveChild.stdout });
    const deadline = delay(10_000, undefined, { ref: false }).then(() => {
      throw new Error('timeout waiting for "listening:" line within 10s');
    });
    const lineP = (async () => {
      for await (const line of rl) {
        const m = /^listening:\s*(\S+)$/.exec(line);
        if (m) {
          rl.close();
          return m[1] ?? '';
        }
      }
      throw new Error('serve stdout closed before "listening:" line');
    })();
    const addr = await Promise.race([lineP, deadline]);
    if (!addr) throw new Error('parsed empty listen address');
    baseURL = `http://${addr}`;
    log(`baseURL=${baseURL}`);
  });

  await step('poll /healthz until 200 {"ok":true}', async () => {
    const deadline = Date.now() + 10_000;
    let last: FetchResult | null = null;
    while (Date.now() < deadline) {
      try {
        last = await jsonRequest(baseURL, 'GET', '/healthz');
        if (
          last.status === 200 &&
          typeof last.body === 'object' &&
          last.body !== null &&
          (last.body as Record<string, unknown>).ok === true
        ) {
          expectNosniff(last, 'healthz 200');
          return;
        }
      } catch {
        // child not ready; keep polling
      }
      await delay(250);
    }
    throw new Error(
      `/healthz never returned 200 {"ok":true} within 10s; last=${last === null ? 'none' : dumpResponse('last', last)}`,
    );
  });

  await step('GET /v1/tokens without bearer → 401 problem+json', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/tokens');
    if (r.status !== 401) throw new Error(dumpResponse('want 401', r));
    expectNosniff(r, '401 unauthorized');
  });

  await step('GET /v1/tokens with root bearer → 200, no secret/hash/salt', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/tokens', { bearer: rootBearer });
    if (r.status !== 200) throw new Error(dumpResponse('want 200', r));
    const body = r.body as { tokens?: Array<Record<string, unknown>> };
    if (!body || !Array.isArray(body.tokens)) {
      throw new Error(dumpResponse('want tokens[] envelope', r));
    }
    for (const entry of body.tokens) {
      for (const k of ['secret', 'token_hash', 'salt']) {
        if (k in entry) throw new Error(`GET /v1/tokens leaked ${k}`);
      }
    }
    expectNosniff(r, 'GET /v1/tokens 200');
  });

  await step('POST /v1/tokens mints secondary l2-canary', async () => {
    const r = await jsonRequest(baseURL, 'POST', '/v1/tokens', {
      bearer: rootBearer,
      body: { name: 'l2-canary' },
    });
    if (r.status !== 201) throw new Error(dumpResponse('want 201', r));
    const body = r.body as { id?: string; secret?: string; prefix?: string };
    if (typeof body.id !== 'string' || typeof body.secret !== 'string') {
      throw new Error('POST /v1/tokens missing id/secret');
    }
    if (!body.secret.startsWith('mwt_') || body.secret.length !== 43) {
      throw new Error('POST /v1/tokens secret malformed');
    }
    secondaryID = body.id;
    secondaryBearer = body.secret;
    log(`secondaryID=${secondaryID} secondaryBearer=${redactBearer(secondaryBearer)}`);
    expectNosniff(r, 'POST /v1/tokens 201');
  });

  await step('DELETE secondary returns 200 + {id, revoked_at}, no secret/hash/salt', async () => {
    const r = await jsonRequest(baseURL, 'DELETE', `/v1/tokens/${secondaryID}`, {
      bearer: rootBearer,
    });
    if (r.status !== 200) throw new Error(dumpResponse('want 200', r));
    const body = r.body as Record<string, unknown>;
    if (body.id !== secondaryID) throw new Error(dumpResponse('want id match', r));
    if (typeof body.revoked_at !== 'string') throw new Error(dumpResponse('want revoked_at', r));
    for (const k of ['secret', 'token_hash', 'salt']) {
      if (k in body) throw new Error(`DELETE /v1/tokens leaked ${k}`);
    }
    expectNosniff(r, 'DELETE /v1/tokens 200');
  });

  await step('GET /v1/tokens with revoked secondary bearer → 401', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/tokens', { bearer: secondaryBearer });
    if (r.status !== 401) throw new Error(dumpResponse('want 401 after revoke', r));
    expectNosniff(r, 'GET /v1/tokens 401 (revoked)');
  });

  await step('GET /v1/tokens with root bearer still 200 (daemon healthy)', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/tokens', { bearer: rootBearer });
    if (r.status !== 200) throw new Error(dumpResponse('want 200 post-revoke', r));
    const body = r.body as { tokens?: Array<Record<string, unknown>> };
    if (!Array.isArray(body.tokens)) throw new Error(dumpResponse('want tokens[]', r));
    for (const entry of body.tokens) {
      for (const k of ['secret', 'token_hash', 'salt']) {
        if (k in entry) throw new Error(`GET /v1/tokens leaked ${k} on second list`);
      }
    }
    expectNosniff(r, 'GET /v1/tokens 200 (post-revoke)');
  });

  await step('SIGTERM serve child and wait for clean exit', async () => {
    if (!serveChild) throw new Error('no serve child to terminate');
    serveChild.kill('SIGTERM');
    const exited = once(serveChild, 'exit');
    const timeout = delay(5_000, undefined, { ref: false }).then(() => 'timeout' as const);
    const winner = await Promise.race([exited, timeout]);
    if (winner === 'timeout') {
      log('SIGTERM did not exit within 5s; sending SIGKILL');
      serveChild.kill('SIGKILL');
      await once(serveChild, 'exit');
    }
    serveExited = true;
  });

  await step('cleanup per-run dir (preserve D1 test root)', () => {
    if (runHome && existsSync(runHome)) {
      rmSync(runHome, { recursive: true, force: true });
    }
    if (!testRootPreexisting && existsSync(TEST_ROOT)) {
      try {
        rmdirSync(TEST_ROOT);
      } catch {
        // non-empty; leave alone.
      }
    }
  });
}

main().then(
  () => {
    stdoutWrite('L2: OK\n');
    log('DONE OK');
    process.exit(0);
  },
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2 fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
