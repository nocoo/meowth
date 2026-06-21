#!/usr/bin/env node
/**
 * scripts/run-exec-l2.ts — Phase 3.11b L2 black-box for the agent
 * exec / sessions / agents endpoints per docs/architecture/02 §4
 * and §6. Reuses the fake backend factory (per-type scenario
 * mapping in internal/server/testbackend) so this harness never
 * needs real CLI binaries.
 *
 * Cases:
 *   E1. GET /v1/agents → 5 supported types, all installed=true
 *       under fake factory.
 *   E2. POST /v1/agents/godot/exec → 404 unknown_backend.
 *   E3. POST /v1/agents/claude/exec with empty prompt → 400
 *       invalid_request.
 *   E4. POST /v1/agents/claude/exec happy path → 200 NDJSON;
 *       client reads session_started + at least one message +
 *       session_ended with status="completed".
 *   E5. GET /v1/sessions → array includes the session minted in
 *       E4.
 *   E6. GET /v1/sessions/{id} → single row.
 *   E7. GET /v1/sessions/{id}/messages → snapshot envelopes;
 *       after_seq filter.
 *   E8. GET /v1/sessions/{id}/messages?follow=true → 400.
 *   E9. POST /v1/sessions/{id}/cancel on a terminal session →
 *       200 already_terminated.
 *   E10. POST /v1/sessions/{unknown}/cancel → 404.
 *
 * Each response also asserts nosniff via expectNosniff (docs/
 * architecture/07 §4.1 C).
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

const REPO_ROOT = process.cwd();
const { MEOWTH_TEST_HOME } = process.env;
const TEST_ROOT = MEOWTH_TEST_HOME ?? join(homedir(), '.meowth-test');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'run-l2-output');
const LOG_PATH = join(OUTPUT_DIR, 'run-exec-l2.log');

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

const testRootPreexisting = existsSync(TEST_ROOT);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  LOG_PATH,
  `# exec L2 matrix run\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
);

let runHome = '';
let serveChild: ChildProcess | null = null;
let serveExited = false;

function cleanup(): void {
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
      // non-empty; leave alone
    }
  }
}
process.on('exit', cleanup);

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

function expectNosniff(r: FetchResult, label: string): void {
  const v = r.headers.get('x-content-type-options');
  if (v !== 'nosniff') {
    throw new Error(`${label}: X-Content-Type-Options = ${v ?? '<missing>'}; want nosniff`);
  }
}

// ndjsonExec POSTs /v1/agents/{type}/exec and parses the NDJSON
// stream line-by-line. Returns the envelope list and the final
// status.
async function ndjsonExec(
  base: string,
  bearer: string,
  agentType: string,
  body: unknown,
): Promise<{ status: number; events: unknown[]; headers: Headers; raw: string }> {
  const r = await fetch(`${base}/v1/agents/${agentType}/exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const events: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore non-JSON noise (problem+json responses are sent
      // before stream start with a different content-type)
    }
  }
  return { status: r.status, events, headers: r.headers, raw: text };
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  stdoutWrite(`L2/EXEC ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    await fn();
    log(`OK   ${label}`);
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2/EXEC ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Build daemon binary once so spawn() reuses the cached compile.
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });

  // Provision an isolated test home + bearer (`init` writes a root
  // token to stdout). Then spawn `meowthd serve` against it with
  // MEOWTH_BACKEND_FACTORY=fake so /v1/agents/* uses the per-type
  // scenario mapping.
  mkdirSync(TEST_ROOT, { recursive: true });
  runHome = mkdtempSync(join(TEST_ROOT, 'exec-'));
  log(`runHome=${runHome}`);

  let rootBearer = '';
  await step('init: mint root token (path A)', () => {
    const out = execFileSync('go', ['run', meowthd, 'init'], {
      cwd: join(REPO_ROOT, 'daemon'),
      encoding: 'utf8',
      env: { ...process.env, MEOWTH_TEST: '1', MEOWTH_TEST_HOME: runHome },
    });
    const first = out.split(/\r?\n/)[0]?.trim() ?? '';
    if (!/^mwt_[A-Za-z0-9]{39}$/.test(first)) {
      throw new Error(`init stdout missing token (len=${String(first.length)})`);
    }
    rootBearer = first;
    return Promise.resolve();
  });

  let baseURL = '';
  await step('spawn meowthd serve (fake factory)', async () => {
    serveChild = spawn('go', ['run', meowthd, 'serve', '--listen-addr=127.0.0.1:0'], {
      cwd: join(REPO_ROOT, 'daemon'),
      env: {
        ...process.env,
        MEOWTH_TEST: '1',
        MEOWTH_TEST_HOME: runHome,
        MEOWTH_BACKEND_FACTORY: 'fake',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!serveChild.stdout || !serveChild.stderr) throw new Error('serve missing stdio');
    serveChild.stderr.pipe(createWriteStream(join(OUTPUT_DIR, 'serve.stderr.log'), { flags: 'a' }));
    serveChild.stdout.pipe(createWriteStream(join(OUTPUT_DIR, 'serve.stdout.log'), { flags: 'a' }));
    serveChild.on('exit', () => {
      serveExited = true;
    });
    const rl = createInterface({ input: serveChild.stdout });
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
    baseURL = `http://${addr}`;
    log(`baseURL=${baseURL}`);
  });

  await step('healthz becomes ready', async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await jsonRequest(baseURL, 'GET', '/healthz');
        if (r.status === 200) {
          expectNosniff(r, 'E0 healthz');
          return;
        }
      } catch {
        // not ready
      }
      await delay(200);
    }
    throw new Error('/healthz never ready');
  });

  // ---------- E1 ----------
  await step('E1 GET /v1/agents → 5 types installed=true', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/agents', { bearer: rootBearer });
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E1');
    const body = r.body as { agents: Array<{ type: string; installed: boolean }> };
    if (!body.agents || body.agents.length !== 5) {
      throw new Error(`expected 5 agents, got ${body.agents?.length ?? 0}`);
    }
    for (const a of body.agents) {
      if (!a.installed) throw new Error(`agent ${a.type} not installed in fake mode`);
    }
  });

  // ---------- E2 ----------
  await step('E2 POST /v1/agents/godot/exec → 404 unknown_backend', async () => {
    const r = await jsonRequest(baseURL, 'POST', '/v1/agents/godot/exec', {
      bearer: rootBearer,
      body: { prompt: 'hi' },
    });
    if (r.status !== 404) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E2');
    const p = r.body as { type?: string };
    if (p.type !== '/problems/unknown_backend') {
      throw new Error(`type=${p.type ?? ''}`);
    }
  });

  // ---------- E3 ----------
  await step('E3 empty prompt → 400 invalid_request', async () => {
    const r = await jsonRequest(baseURL, 'POST', '/v1/agents/claude/exec', {
      bearer: rootBearer,
      body: { prompt: '' },
    });
    if (r.status !== 400) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E3');
  });

  // ---------- E4 ----------
  let sessionID = '';
  await step('E4 claude exec happy stream → session_started + session_ended', async () => {
    const r = await ndjsonExec(baseURL, rootBearer, 'claude', { prompt: 'Hello agent' });
    if (r.status !== 200) throw new Error(`status=${r.status} body=${r.raw}`);
    expectNosniff({ status: r.status, body: null, headers: r.headers }, 'E4');
    if (r.events.length < 2) throw new Error(`too few events: ${r.events.length}`);
    const started = r.events[0] as { type: string; session_id: string };
    if (started.type !== 'session_started') throw new Error(`first event type=${started.type}`);
    sessionID = started.session_id;
    const last = r.events[r.events.length - 1] as { type: string; payload: { status: string } };
    if (last.type !== 'session_ended') throw new Error(`last event type=${last.type}`);
    if (last.payload.status !== 'completed') {
      throw new Error(`final status=${last.payload.status}`);
    }
    if (!r.events.some((e) => (e as { type: string }).type === 'message')) {
      throw new Error('no message events');
    }
  });

  // ---------- E5 ----------
  await step('E5 GET /v1/sessions → includes minted session', async () => {
    const r = await jsonRequest(baseURL, 'GET', '/v1/sessions', { bearer: rootBearer });
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E5');
    const body = r.body as { sessions: Array<{ id: string }> };
    if (!body.sessions.some((s) => s.id === sessionID)) {
      throw new Error(`session ${sessionID} not in list`);
    }
  });

  // ---------- E6 ----------
  await step('E6 GET /v1/sessions/{id} → single row', async () => {
    const r = await jsonRequest(baseURL, 'GET', `/v1/sessions/${sessionID}`, { bearer: rootBearer });
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E6');
    const body = r.body as { id: string; status: string };
    if (body.id !== sessionID) throw new Error(`id mismatch`);
    if (body.status !== 'completed') throw new Error(`status=${body.status}`);
  });

  // ---------- E7 ----------
  await step('E7 GET /v1/sessions/{id}/messages → snapshot + after_seq', async () => {
    const r = await jsonRequest(baseURL, 'GET', `/v1/sessions/${sessionID}/messages`, { bearer: rootBearer });
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E7');
    const body = r.body as { events: unknown[]; has_more: boolean };
    if (body.events.length < 2) throw new Error(`events=${body.events.length}`);
    if (body.has_more) throw new Error('has_more should be false');
    // after_seq filter
    const r2 = await jsonRequest(baseURL, 'GET', `/v1/sessions/${sessionID}/messages?after_seq=0`, {
      bearer: rootBearer,
    });
    const body2 = r2.body as { events: unknown[] };
    if (body2.events.length !== body.events.length - 1) {
      throw new Error(`after_seq filter: ${body2.events.length} vs ${body.events.length - 1}`);
    }
  });

  // ---------- E8 ----------
  await step('E8 follow=true → 400 invalid_request', async () => {
    const r = await jsonRequest(baseURL, 'GET', `/v1/sessions/${sessionID}/messages?follow=true`, {
      bearer: rootBearer,
    });
    if (r.status !== 400) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E8');
  });

  // ---------- E9 ----------
  await step('E9 cancel terminal session → 200 already_terminated', async () => {
    const r = await jsonRequest(baseURL, 'POST', `/v1/sessions/${sessionID}/cancel`, {
      bearer: rootBearer,
    });
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E9');
    const body = r.body as { status: string };
    if (body.status !== 'already_terminated') throw new Error(`status=${body.status}`);
  });

  // ---------- E10 ----------
  await step('E10 cancel unknown session → 404 session_not_found', async () => {
    const r = await jsonRequest(baseURL, 'POST', '/v1/sessions/01900000-0000-7000-8000-000000000000/cancel', {
      bearer: rootBearer,
    });
    if (r.status !== 404) throw new Error(`status=${r.status}`);
    expectNosniff(r, 'E10');
    const body = r.body as { type?: string };
    if (body.type !== '/problems/session_not_found') {
      throw new Error(`type=${body.type ?? ''}`);
    }
  });

  // SIGTERM serve + wait
  await step('SIGTERM serve + wait', async () => {
    if (!serveChild) throw new Error('serve child missing');
    serveChild.kill('SIGTERM');
    const exited = once(serveChild, 'exit');
    const timeout = delay(5_000).then(() => 'timeout' as const);
    const winner = await Promise.race([exited, timeout]);
    if (winner === 'timeout') {
      serveChild.kill('SIGKILL');
      await once(serveChild, 'exit');
    }
    serveExited = true;
  });

  stdoutWrite('L2/EXEC: OK (10 cases)\n');
  log('DONE OK');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2/EXEC fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
