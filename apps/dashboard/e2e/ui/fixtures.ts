import type { Page } from '@playwright/test';
import type { Agent, Envelope, Session, TokenView } from '../../src/models/types';

export const AGENTS: Agent[] = [
  { type: 'claude', installed: true, executable: '/usr/local/bin/claude', version: '2.1.76' },
  { type: 'codex', installed: true, executable: '/usr/local/bin/codex', version: '0.107.0' },
  { type: 'copilot', installed: true, executable: '/usr/local/bin/copilot', version: '1.0.12' },
  { type: 'hermes', installed: false, executable: '', version: '' },
  { type: 'pi', installed: false, executable: '', version: '' },
];

export const SESSIONS: Session[] = [
  {
    id: 'ui-session-1',
    backend_type: 'claude',
    backend_session_id: 'ui-backend-1',
    status: 'completed',
    model: 'claude-sonnet-4-6',
    started_at: '2026-09-08T06:10:00+08:00',
    ended_at: '2026-09-08T06:12:00+08:00',
    thread_name: 'Dashboard design review',
  },
  {
    id: 'ui-session-2',
    backend_type: 'codex',
    backend_session_id: 'ui-backend-2',
    status: 'running',
    model: 'gpt-5.4',
    started_at: '2026-09-08T06:25:00+08:00',
    ended_at: null,
    thread_name: 'Frontend development',
  },
];

const TOKENS: TokenView[] = [
  {
    id: 'ui-token-1',
    name: 'Local dashboard',
    prefix: 'mwt_preview',
    created_at: '2026-09-01T08:00:00+08:00',
    created_via: 'init',
    last_used_at: null,
  },
];

export const LONG_OUTPUT = `界面已经准备好。\n${'long_filename_without_spaces_'.repeat(45)}\n<img src=x onerror=alert(1)>`;

const MESSAGES: Envelope[] = [
  {
    v: 1,
    seq: 1,
    ts: '2026-09-08T06:12:00+08:00',
    session_id: 'ui-session-1',
    type: 'session_started',
    payload: { backend_session_id: 'ui-backend-1' },
  },
  {
    v: 1,
    seq: 2,
    ts: '2026-09-08T06:12:01+08:00',
    session_id: 'ui-session-1',
    type: 'message',
    payload: { kind: 'text', content: LONG_OUTPUT },
  },
  {
    v: 1,
    seq: 3,
    ts: '2026-09-08T06:12:02+08:00',
    session_id: 'ui-session-1',
    type: 'session_ended',
    payload: { status: 'completed', duration_ms: 2000 },
  },
];

export async function mockDashboard(
  page: Page,
  overrides: { agents?: Agent[]; sessions?: Session[]; tokens?: TokenView[] } = {},
) {
  await page.addInitScript(() => localStorage.setItem('meowth_token', 'visual-preview'));
  await page.route('**/healthz', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/exec')) {
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${MESSAGES.map((message) => JSON.stringify(message)).join('\n')}\n`,
      });
    } else if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405 });
    } else if (pathname === '/v1/agents') {
      await route.fulfill({ json: { agents: overrides.agents ?? AGENTS } });
    } else if (pathname === '/v1/tokens') {
      await route.fulfill({ json: { tokens: overrides.tokens ?? TOKENS } });
    } else if (pathname === '/v1/sessions') {
      await route.fulfill({ json: { sessions: overrides.sessions ?? SESSIONS } });
    } else if (pathname.endsWith('/messages')) {
      await route.fulfill({ json: { messages: MESSAGES } });
    } else if (pathname === '/v1/sessions/ui-session-1') {
      await route.fulfill({ json: SESSIONS[0] });
    } else {
      await route.fulfill({ status: 404 });
    }
  });
}
