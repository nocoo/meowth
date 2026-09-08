import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { type Browser, type Page, chromium, expect } from '@playwright/test';
import { type ViteDevServer, createServer as createViteServer } from 'vite';
import { buildMeowthd } from '../../../../scripts/lib/build-meowthd';
import type { Agent, Envelope } from '../../src/models/types';

const { MEOWTH_REAL_CHAT: enabled, MEOWTH_REAL_CHAT_AGENTS: requestedAgents } = process.env;

if (enabled !== '1') {
  process.stdout.write('Real Chat skipped. Set MEOWTH_REAL_CHAT=1 to use installed agents.\n');
  process.exit(0);
}

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(dashboardRoot, '../..');
const output = join(
  repoRoot,
  'scripts/run-l2-output/real-chat',
  new Date().toISOString().replaceAll(':', '-'),
);
const runHome = mkdtempSync(join(tmpdir(), 'meowth-real-chat-'));
const workdir = join(runHome, 'workspace');
mkdirSync(workdir);
mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  MEOWTH_TEST: '1',
  MEOWTH_TEST_HOME: join(runHome, 'daemon'),
  MEOWTH_BACKEND_FACTORY: 'production',
};
const children: ChildProcess[] = [];
let browser: Browser | undefined;
let vite: ViteDevServer | undefined;
const results: {
  agent: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  durationMs?: number;
}[] = [];
const selected = requestedAgents?.split(',');

function log(message: string) {
  process.stdout.write(`[real-chat] ${message}\n`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function waitReady(url: string, child: ChildProcess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Fixture exited (${child.exitCode})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Fixture did not become ready: ${url}`);
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function cleanup() {
  await browser?.close();
  await vite?.close();
  for (const child of children.toReversed()) await stop(child);
  rmSync(runHome, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

function errorText(error: unknown): string {
  return String(error)
    .replace(/mwt_[A-Za-z0-9]+/g, '[fixture bearer]')
    .slice(0, 4000);
}

function field(event: Envelope | undefined, key: string): unknown {
  return event?.payload[key];
}

async function send(page: Page, agent: string, prompt: string, turn: number) {
  const incoming = page.waitForResponse(
    (response) => response.url().endsWith(`/v1/agents/${agent}/exec`),
    { timeout: 30_000 },
  );
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await incoming;
  if (!response.ok()) throw new Error(`Exec HTTP ${response.status()}`);
  const article = page.getByRole('article', { name: `Turn ${turn}`, exact: true });
  const readBody = response.text();
  const deadline = setTimeout(() => {
    void page.close();
  }, 660_000);
  let body: string;
  try {
    body = await readBody;
  } finally {
    clearTimeout(deadline);
  }
  const events = body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Envelope);
  writeFileSync(join(output, `${agent}-turn-${turn}.json`), JSON.stringify(events, null, 2), {
    mode: 0o600,
  });
  const terminal = events.findLast((event) => event.type === 'session_ended');
  if (field(terminal, 'status') !== 'completed') {
    const errors = events
      .filter((event) => event.type === 'error' || field(event, 'kind') === 'error')
      .map((event) => event.payload);
    throw new Error(`Terminal ${String(field(terminal, 'status'))}: ${JSON.stringify(errors)}`);
  }
  if (
    typeof field(terminal, 'backend_session_id') !== 'string' ||
    !field(terminal, 'backend_session_id')
  ) {
    throw new Error('Completed without a backend continuation ID');
  }
  await expect(article.locator('[data-bubble-kind="session-ended"]')).toContainText('Completed');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  return { article, events, backendId: field(terminal, 'backend_session_id') };
}

async function checkAgent(agent: Agent, base: string, bearer: string, browser: Browser) {
  if (!agent.installed) {
    results.push({ agent: agent.type, status: 'skip', detail: 'CLI not installed on PATH' });
    log(`${agent.type}: not installed`);
    return;
  }
  const start = Date.now();
  log(`${agent.type}: testing real Markdown output`);
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(
    (token: string) => localStorage.setItem('meowth_token', token),
    bearer,
  );
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  try {
    await page.goto('/chat');
    await page.getByRole('combobox', { name: 'Choose agent' }).click();
    const agentLabel =
      agent.type === 'pi' ? 'Pi' : agent.type[0]?.toUpperCase() + agent.type.slice(1);
    await page.getByRole('option', { name: agentLabel, exact: true }).click();
    const marker = `meowth-${randomUUID()}`;
    const code = 'const total = 2 + 2;';
    const prompt = [
      'This is a harmless chat-rendering verification. Do not call tools, access files, use a shell, or change anything.',
      'Reply with the following Markdown exactly, without enclosing the whole answer in a code fence. Remember the verification marker for my next question.',
      '',
      '## Rendering check',
      '',
      '**Completed** with *consistent typography* and `inline code`.',
      '',
      '- Clear spacing',
      '- Nested content',
      '  - A second level',
      '',
      '> A readable quotation.',
      '',
      '```typescript',
      code,
      '```',
      '',
      '| Left | Center | Right |',
      '| :--- | :---: | ---: |',
      '| Basalt | Ready | 42 |',
      '',
      '- [x] Formatting verified',
      '',
      `Verification marker: ${marker}`,
    ].join('\n');
    const first = await send(page, agent.type, prompt, 1);
    const reply = first.article.locator('[data-bubble-kind="text"]');
    await expect(reply.getByRole('heading', { name: 'Rendering check', level: 2 })).toBeVisible();
    await expect(reply.locator('strong')).toContainText('Completed');
    await expect(reply.getByRole('cell', { name: 'Basalt' })).toHaveCSS('text-align', 'left');
    await expect(reply.getByRole('cell', { name: 'Ready' })).toHaveCSS('text-align', 'center');
    await expect(reply.getByRole('cell', { name: '42' })).toHaveCSS('text-align', 'right');
    await expect(reply.locator('blockquote')).toContainText('A readable quotation.');
    await expect(reply.locator('em')).toContainText('consistent typography');
    await expect(reply.locator('ul ul li')).toContainText('A second level');
    await expect(reply.getByRole('checkbox')).toBeChecked();
    await reply.getByRole('button', { name: 'Copy code' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await page.screenshot({ path: join(output, `${agent.type}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    expect(
      await page
        .locator('[data-slot="chat-shell"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: join(output, `${agent.type}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
    log(`${agent.type}: formatting passed; testing real continuation`);
    const requestPromise = page.waitForRequest((request) =>
      request.url().endsWith(`/v1/agents/${agent.type}/exec`),
    );
    const second = await send(
      page,
      agent.type,
      'What verification marker did I give you in the previous turn? Reply with just that exact marker. Do not call tools or access any files.',
      2,
    );
    const request = await requestPromise;
    expect(request.postDataJSON().resume_session_id).toBe(first.backendId);
    await expect(second.article.locator('[data-bubble-kind="text"]')).toContainText(marker);
    expect(browserErrors).toEqual([]);
    results.push({
      agent: agent.type,
      status: 'pass',
      detail: 'Real Markdown, code copy, table alignment, mobile layout, and continuation verified',
      durationMs: Date.now() - start,
    });
    log(`${agent.type}: PASS`);
  } catch (error) {
    const detail = errorText(error);
    results.push({ agent: agent.type, status: 'fail', detail, durationMs: Date.now() - start });
    log(`${agent.type}: FAIL ${detail}`);
    if (!page.isClosed())
      await page.screenshot({ path: join(output, `${agent.type}-failure.png`) });
  } finally {
    await context.close();
    writeFileSync(join(output, 'summary.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
  }
}

try {
  const binary = buildMeowthd('meowthd-real-chat');
  const init = execFileSync(binary, ['init'], {
    cwd: workdir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const bearer = init.split('\n')[0]?.trim();
  if (!bearer?.startsWith('mwt_')) throw new Error('Fixture init did not mint a bearer');
  const daemonPort = await freePort();
  const daemonBase = `http://127.0.0.1:${daemonPort}`;
  const daemon = spawn(binary, ['serve', '--listen-addr', `127.0.0.1:${daemonPort}`], {
    cwd: workdir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(daemon);
  daemon.stdout?.resume();
  daemon.stderr?.resume();
  await waitReady(`${daemonBase}/healthz`, daemon);
  const vitePort = await freePort();
  const base = `http://127.0.0.1:${vitePort}`;
  vite = await createViteServer({
    root: dashboardRoot,
    cacheDir: join(runHome, 'vite-cache'),
    server: {
      port: vitePort,
      strictPort: true,
      watch: null,
      proxy: {
        '/v1': { target: daemonBase, changeOrigin: false },
        '/healthz': { target: daemonBase, changeOrigin: false },
      },
    },
  });
  await vite.listen();
  browser = await chromium.launch();
  const response = await fetch(`${daemonBase}/v1/agents`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!response.ok) throw new Error(`Agent inventory HTTP ${response.status}`);
  const { agents } = (await response.json()) as { agents: Agent[] };
  log(
    `Inventory: ${agents.map((agent) => `${agent.type}=${agent.installed ? 'installed' : 'missing'}`).join(', ')}`,
  );
  for (const agent of agents) {
    if (!selected || selected.includes(agent.type)) await checkAgent(agent, base, bearer, browser);
  }
  log(`Report: ${output}`);
  if (results.some((result) => result.status === 'fail')) process.exitCode = 1;
} catch (error) {
  log(`Fixture failed: ${errorText(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
