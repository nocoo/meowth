#!/usr/bin/env node
/**
 * scripts/run-chat-l2.ts — Chat L2 black-box harness covering
 * docs/features/03 §3.3 resume-id propagation against a real
 * daemon + fake backend factory. The harness drives two POST
 * /v1/agents/{type}/exec turns, then reads the test-only recorder
 * artifact added in commit #7 (`daemon/internal/server/
 * testbackend/recorder.go`) to assert:
 *
 *   - Turn 1 ExecRequest carries `resume_session_id === ""`
 *   - Turn 2 ExecRequest carries `resume_session_id` equal to the
 *     `session_ended.payload.backend_session_id` produced by Turn 1
 *
 * That last assertion is the §3.3 red line: a future regression
 * that copies a provisional id from `message.kind=status` (or that
 * forgets to propagate at all) breaks here loudly with a real
 * daemon in the loop.
 *
 * Credential hygiene
 * - The root bearer is NEVER written to any artifact. No prefix,
 *   no full value. Request bodies (and their `prompt` strings)
 *   are also never logged.
 * - The recorder itself sits below the HTTP layer (see commit #7),
 *   so it cannot see the bearer. The redaction scan at the end of
 *   this harness re-checks every artifact for forbidden
 *   substrings as a belt-and-suspenders against future logging
 *   drift.
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
const LOG_PATH = join(OUTPUT_DIR, 'run-chat-l2.log');
const SERVE_STDOUT = join(OUTPUT_DIR, 'chat-serve.stdout.log');
const SERVE_STDERR = join(OUTPUT_DIR, 'chat-serve.stderr.log');
const RECORDER_PATH = join(OUTPUT_DIR, 'chat-exec-log.jsonl');
const TEST_MARKER = 'chat-l2-run-1';

// Fixed-size ASCII prompts so we can assert `prompt_length`
// strictly. Both are 8 bytes; neither contains `mwt_` / `mws_` /
// `Bearer` / `Authorization` substrings that the redaction scan
// looks for.
const PROMPT_T1 = 'turn-one';
const PROMPT_T2 = 'turn-two';

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

const testRootPreexisting = existsSync(TEST_ROOT);
mkdirSync(OUTPUT_DIR, { recursive: true });
// Per-run reset of every artifact this harness writes. The
// recorder + harness log are obviously per-run; the daemon stdio
// captures are reset too so the redaction scan at the end never
// reads stale bytes from a prior run (which would make both the
// pass/fail signal and the artifact report misleading).
if (existsSync(RECORDER_PATH)) rmSync(RECORDER_PATH, { force: true });
if (existsSync(SERVE_STDOUT)) rmSync(SERVE_STDOUT, { force: true });
if (existsSync(SERVE_STDERR)) rmSync(SERVE_STDERR, { force: true });
writeFileSync(
  LOG_PATH,
  `# chat L2 run\n# test root: ${TEST_ROOT} (preexisting=${String(testRootPreexisting)})\n`,
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

function expectNosniff(headers: Headers, label: string): void {
  const v = headers.get('x-content-type-options');
  if (v !== 'nosniff') {
    throw new Error(`${label}: X-Content-Type-Options = ${v ?? '<missing>'}; want nosniff`);
  }
}

interface Envelope {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

async function ndjsonExec(
  base: string,
  bearer: string,
  body: unknown,
): Promise<{ status: number; headers: Headers; events: Envelope[] }> {
  const r = await fetch(`${base}/v1/agents/claude/exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const events: Envelope[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: Envelope;
    try {
      parsed = JSON.parse(line) as Envelope;
    } catch (err) {
      throw new Error(`malformed NDJSON line: ${String(err)}`);
    }
    events.push(parsed);
  }
  return { status: r.status, headers: r.headers, events };
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  stdoutWrite(`L2/CHAT ▸ ${label}\n`);
  log(`STEP ${label}`);
  try {
    await fn();
    log(`OK   ${label}`);
  } catch (err) {
    log(`FAIL ${label}: ${String(err)}`);
    stderrWrite(`L2/CHAT ✘ ${label}\n${String(err)}\n`);
    process.exit(1);
  }
}

function requireString(env: Envelope, field: 'session_id'): string;
function requireString(
  env: Envelope,
  field: keyof Envelope | 'backend_session_id' | 'status',
): string;
function requireString(env: Envelope, field: string): string {
  if (field === 'session_id') {
    const v = env.session_id;
    if (typeof v !== 'string' || v === '') {
      throw new Error(`expected non-empty session_id; got ${String(v)}`);
    }
    return v;
  }
  const payload = env.payload ?? {};
  const v = (payload as Record<string, unknown>)[field];
  if (typeof v !== 'string' || v === '') {
    throw new Error(`expected non-empty payload.${field}; got ${String(v)}`);
  }
  return v;
}

function assertSessionEnded(events: Envelope[], label: string): { bsid: string } {
  if (events.length === 0) {
    throw new Error(`${label}: no envelopes received`);
  }
  const last = events[events.length - 1] as Envelope;
  if (last.type !== 'session_ended') {
    throw new Error(`${label}: stream ended with ${last.type}, not session_ended`);
  }
  const status = requireString(last, 'status');
  if (status !== 'completed') {
    throw new Error(`${label}: session_ended status=${status}, want completed`);
  }
  const bsid = requireString(last, 'backend_session_id');
  return { bsid };
}

interface RecorderRow {
  backend_type: string;
  call_seq: number;
  resume_session_id: string;
  prompt_length: number;
  test_marker: string;
}

const ALLOWED_RECORDER_KEYS = new Set([
  'backend_type',
  'call_seq',
  'resume_session_id',
  'prompt_length',
  'test_marker',
]);

function parseRecorderFile(path: string): { rows: RecorderRow[]; raw: string } {
  if (!existsSync(path)) {
    throw new Error(`recorder file missing: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  const rows: RecorderRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`recorder line malformed: ${String(err)}`);
    }
    const keys = Object.keys(obj);
    if (keys.length !== ALLOWED_RECORDER_KEYS.size) {
      throw new Error(
        `recorder line has ${String(keys.length)} keys, want ${String(ALLOWED_RECORDER_KEYS.size)}: ${keys.join(',')}`,
      );
    }
    for (const k of keys) {
      if (!ALLOWED_RECORDER_KEYS.has(k)) {
        throw new Error(`recorder line has forbidden key ${k}`);
      }
    }
    rows.push(obj as unknown as RecorderRow);
  }
  return { rows, raw };
}

// Belt-and-suspenders: scan every artifact this harness writes
// for substrings that would indicate a credential / prompt leak.
// The recorder itself can never see the bearer (it is below the
// HTTP layer), and we intentionally never log request bodies, so
// these substrings should not appear in OUR own files. The
// daemon's own structured log emits a redacted 9-char
// `bearer_prefix=mwt_XXXXX` for observability — that prefix is
// the documented convention (architecture/07 logging), so the
// scan tolerates the `mwt_` literal inside the daemon-stdio
// capture files. To keep that tolerance honest, the scan ALSO
// performs two stricter checks across every artifact:
//   1. the verbatim `rootBearer` value (the full minted token
//      this run produced) must never appear anywhere
//   2. a generic full-bearer regex (`mwt_` + at least 30 base62
//      chars) must never match anywhere — catches a leak even
//      from a token this harness never minted
// A regression that prints the full bearer into daemon stderr
// would slip past the prefix-only tolerance via (1) and (2)
// here.
function redactionScan(rootBearer: string): void {
  const everywhereForbidden = [
    'mws_',
    'Authorization',
    'Bearer ',
    PROMPT_T1,
    PROMPT_T2,
  ];
  // The minted root token (`mwt_` + 39 base62 chars). Locked
  // against the verbatim value so even a partial-but-revealing
  // leak fails the scan.
  if (rootBearer !== '') everywhereForbidden.push(rootBearer);
  // Generic full-bearer pattern. The current generator emits
  // 39 base62 chars after `mwt_`; require at least 30 to flag a
  // full secret while still allowing the documented 9-char
  // `bearer_prefix` redaction. Charset matches architecture/07.
  const fullBearerRe = /\bmwt_[A-Za-z0-9]{30,}\b/;
  const ourOnlyForbidden = ['mwt_'];
  const ourArtifacts = [LOG_PATH, RECORDER_PATH];
  const daemonArtifacts = [SERVE_STDOUT, SERVE_STDERR];
  for (const file of [...ourArtifacts, ...daemonArtifacts]) {
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');
    for (const needle of everywhereForbidden) {
      if (body.includes(needle)) {
        throw new Error(`redaction scan: ${file} contains forbidden substring ${needle}`);
      }
    }
    const m = fullBearerRe.exec(body);
    if (m !== null) {
      throw new Error(
        `redaction scan: ${file} matches full-bearer pattern (len=${String(m[0].length)})`,
      );
    }
  }
  for (const file of ourArtifacts) {
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');
    for (const needle of ourOnlyForbidden) {
      if (body.includes(needle)) {
        throw new Error(`redaction scan: ${file} contains forbidden substring ${needle}`);
      }
    }
  }
}

async function main(): Promise<void> {
  execFileSync('pnpm', ['daemon:build'], { stdio: 'inherit', cwd: REPO_ROOT });
  meowthdBinary = buildMeowthd('meowthd-chat-l2');

  mkdirSync(TEST_ROOT, { recursive: true });
  runHome = mkdtempSync(join(TEST_ROOT, 'chat-'));
  log(`runHome=${runHome}`);

  let rootBearer = '';
  await step('init: mint root token (path A)', () => {
    const out = execFileSync(meowthdBinary, ['init'], {
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
  await step('spawn meowthd serve (fake factory + recorder)', async () => {
    serveChild = spawn(meowthdBinary, ['serve', '--listen-addr=127.0.0.1:0'], {
      env: {
        ...process.env,
        MEOWTH_TEST: '1',
        MEOWTH_TEST_HOME: runHome,
        MEOWTH_BACKEND_FACTORY: 'fake',
        MEOWTH_CHAT_L2_RECORDER_PATH: RECORDER_PATH,
        MEOWTH_CHAT_L2_TEST_MARKER: TEST_MARKER,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!serveChild.stdout || !serveChild.stderr) throw new Error('serve missing stdio');
    serveChild.stderr.pipe(createWriteStream(SERVE_STDERR, { flags: 'a' }));
    serveChild.stdout.pipe(createWriteStream(SERVE_STDOUT, { flags: 'a' }));
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
          expectNosniff(r.headers, 'healthz');
          return;
        }
      } catch {
        // not ready yet
      }
      await delay(200);
    }
    throw new Error('/healthz never ready');
  });

  let bsidT1 = '';
  await step('Turn 1: POST exec without resume_session_id → 200 + session_ended', async () => {
    const r = await ndjsonExec(baseURL, rootBearer, {
      prompt: PROMPT_T1,
      timeout_ms: 600_000,
      semantic_inactivity_timeout_ms: 60_000,
    });
    if (r.status !== 200) throw new Error(`turn1 status=${r.status}`);
    expectNosniff(r.headers, 'turn1');
    const ended = assertSessionEnded(r.events, 'turn1');
    bsidT1 = ended.bsid;
    log(`turn1 backend_session_id observed`);
  });

  await step('Turn 2: POST exec with resume_session_id=bsidT1 → 200 + session_ended', async () => {
    const r = await ndjsonExec(baseURL, rootBearer, {
      prompt: PROMPT_T2,
      timeout_ms: 600_000,
      semantic_inactivity_timeout_ms: 60_000,
      resume_session_id: bsidT1,
    });
    if (r.status !== 200) throw new Error(`turn2 status=${r.status}`);
    expectNosniff(r.headers, 'turn2');
    assertSessionEnded(r.events, 'turn2');
  });

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

  await step('recorder log: §3.3 resume id propagation', () => {
    const { rows } = parseRecorderFile(RECORDER_PATH);
    if (rows.length !== 2) {
      throw new Error(`recorder rows = ${rows.length}, want 2`);
    }
    const [t1, t2] = rows as [RecorderRow, RecorderRow];
    if (t1.backend_type !== 'fake' || t2.backend_type !== 'fake') {
      throw new Error(`backend_type mismatch: ${t1.backend_type} / ${t2.backend_type}`);
    }
    if (t1.call_seq !== 1 || t2.call_seq !== 2) {
      throw new Error(`call_seq mismatch: ${t1.call_seq} / ${t2.call_seq}`);
    }
    if (t1.test_marker !== TEST_MARKER || t2.test_marker !== TEST_MARKER) {
      throw new Error(`test_marker mismatch: ${t1.test_marker} / ${t2.test_marker}`);
    }
    if (t1.prompt_length !== PROMPT_T1.length || t2.prompt_length !== PROMPT_T2.length) {
      throw new Error(
        `prompt_length mismatch: ${t1.prompt_length}/${t2.prompt_length} want ${PROMPT_T1.length}/${PROMPT_T2.length}`,
      );
    }
    if (t1.resume_session_id !== '') {
      throw new Error(`turn1 resume_session_id should be empty, got ${t1.resume_session_id}`);
    }
    if (t2.resume_session_id === '') {
      throw new Error('turn2 resume_session_id should be non-empty');
    }
    if (t2.resume_session_id !== bsidT1) {
      throw new Error(
        `§3.3 RED LINE: turn2 resume_session_id (${t2.resume_session_id}) !== turn1 session_ended.backend_session_id (${bsidT1})`,
      );
    }
    return Promise.resolve();
  });

  await step('redaction scan: artifacts contain no prompt/bearer/header substrings', () => {
    redactionScan(rootBearer);
    return Promise.resolve();
  });

  stdoutWrite('L2/CHAT: OK (two-turn resume id propagation)\n');
  log('DONE OK');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log(`FATAL ${String(err)}`);
    stderrWrite(`L2/CHAT fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
