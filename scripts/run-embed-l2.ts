// L2 embed test (docs/architecture/06 §3.4.2 + 07 §4 §11).
//
// Builds meowthd binary with the freshly copied dashboard dist
// embedded, starts it on 127.0.0.1:0, and asserts:
//   - GET /          → 200 text/html + Content-Security-Policy
//   - GET /assets/*  → 200 with Cache-Control: ... immutable
//   - GET /v1/agents → 401 problem+json (reserved namespace; no
//     SPA leak; bearer middleware enforced)
//   - POST /bootstrap/mint → not 200 / no index.html in body
//                            (unmounted route or proper 4xx)
//
// The output binary lives in scripts/run-l2-output/ (gitignored).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts/run-l2-output');
const BINARY = join(OUTPUT_DIR, 'meowthd-embed');

function step(msg: string): void {
  process.stdout.write(`[l2-embed] ${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`[l2-embed] FAIL: ${msg}\n`);
  process.exit(1);
}

function exec(cmd: string, args: string[], cwd: string): void {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} → status ${res.status}`);
}

// Step 1: build embed binary (rely on caller having run
// `pnpm daemon:build` first; we just re-emit the binary to a
// deterministic output path so we can spawn it).
mkdirSync(OUTPUT_DIR, { recursive: true });
step(`go build -o ${BINARY} ./cmd/meowthd`);
exec('go', ['build', '-o', BINARY, './cmd/meowthd'], join(REPO_ROOT, 'daemon'));

// Step 2: mint a root token via path A inside a throw-away home.
const home = mkdtempSync(join(tmpdir(), 'meowth-l2-embed-home-'));
process.on('exit', () => {
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

step('meowthd init under MEOWTH_TEST_HOME');
const initRes = spawnSync(BINARY, ['init'], {
  env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (initRes.status !== 0) fail(`meowthd init exit ${initRes.status}`);
const token = (initRes.stdout ?? '').split('\n', 2)[0]?.trim() ?? '';
if (!token.startsWith('mwt_')) fail('init did not yield mwt_ token');

// Step 3: serve on 127.0.0.1:0; parse `listening: host:port` from stdout.
step('meowthd serve --listen-addr 127.0.0.1:0');
const serve = spawn(BINARY, ['serve', '--listen-addr', '127.0.0.1:0'], {
  env: { ...process.env, MEOWTH_TEST_HOME: home, MEOWTH_TEST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let addr = '';
let bufferedStdout = '';

const ready = new Promise<string>((resolveReady, rejectReady) => {
  const timer = setTimeout(() => {
    rejectReady(new Error('meowthd serve did not print listening: within 30s'));
  }, 30_000);
  serve.stdout.on('data', (chunk: Buffer) => {
    bufferedStdout += chunk.toString();
    const match = bufferedStdout.match(/listening:\s*([0-9.:]+)/);
    if (match) {
      clearTimeout(timer);
      resolveReady(match[1]);
    }
  });
  serve.on('exit', (code) => {
    rejectReady(new Error(`meowthd serve exited early code=${code}`));
  });
});

function stop(): void {
  if (!serve.killed) {
    serve.kill('SIGTERM');
  }
}
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(143);
});

async function main(): Promise<void> {
  addr = await ready;
  step(`daemon listening at ${addr}`);
  const base = `http://${addr}`;

  // GET / — index.html + CSP
  step('GET / expects 200 text/html + CSP');
  const rootRes = await fetch(`${base}/`);
  if (rootRes.status !== 200) fail(`GET / status = ${rootRes.status}`);
  const ct = rootRes.headers.get('content-type') ?? '';
  if (!ct.startsWith('text/html')) fail(`GET / content-type = ${ct}`);
  if (!rootRes.headers.get('content-security-policy')) fail('GET / missing CSP header');
  const rootBody = await rootRes.text();
  if (!rootBody.includes('<!doctype html>') && !rootBody.includes('<!DOCTYPE html>')) {
    fail('GET / body did not look like dashboard index.html');
  }

  // Find one hashed asset in the body and fetch it.
  const assetMatch = rootBody.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!assetMatch) fail('GET / body did not reference /assets/index-*.js');
  const assetPath = assetMatch[0];
  step(`GET ${assetPath} expects 200 immutable`);
  const assetRes = await fetch(`${base}${assetPath}`);
  if (assetRes.status !== 200) fail(`GET ${assetPath} status = ${assetRes.status}`);
  const cache = assetRes.headers.get('cache-control') ?? '';
  if (!cache.includes('immutable')) fail(`GET ${assetPath} cache-control = ${cache}`);

  // GET /v1/agents — reserved; no bearer → 401 problem+json
  step('GET /v1/agents expects 401 problem+json (no bearer)');
  const agentsRes = await fetch(`${base}/v1/agents`);
  if (agentsRes.status !== 401) fail(`GET /v1/agents status = ${agentsRes.status}`);
  const agentsCT = agentsRes.headers.get('content-type') ?? '';
  if (!agentsCT.includes('problem+json')) fail(`GET /v1/agents content-type = ${agentsCT}`);

  // POST /bootstrap/mint — first-run already closed (token exists) so
  // route is unmounted; expect 404 problem+json, not index.html.
  step('POST /bootstrap/mint expects 404 problem+json (no SPA leak)');
  const mintRes = await fetch(`${base}/bootstrap/mint`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  if (mintRes.status === 200) fail('POST /bootstrap/mint returned 200 — should not');
  const mintBody = await mintRes.text();
  if (mintBody.includes('<html')) fail('POST /bootstrap/mint leaked index.html');

  step('L2/EMBED: OK');
}

main()
  .then(() => {
    stop();
    process.exit(0);
  })
  .catch((err) => {
    stop();
    process.stderr.write(`[l2-embed] ${(err as Error).message}\n`);
    process.exit(1);
  });
