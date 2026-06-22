import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/02 §5 + 06 §11 (a) — drive a fake agent exec
// against the same-origin daemon, then assert the dashboard
// renders the resulting session's messages via the existing
// snapshot pipeline (06 §7.3). MEOWTH_BACKEND_FACTORY=fake plays
// the happy.jsonl fixture, which produces two `text` messages plus
// a session_ended terminal envelope.

test('fake claude exec → session detail renders happy fixture content + session_ended', async ({
  page,
}) => {
  await handpasteToken(page);

  // Drive exec from the page so we exercise the same-origin daemon
  // and the bearer that AuthGate already wrote to localStorage.
  // This issues a raw `fetch` with an explicit Authorization header
  // (not the app's apiFetch — that's not accessible from
  // page.evaluate).
  const sessionId: string = await page.evaluate(async () => {
    const token = window.localStorage.getItem('meowth_token');
    if (token === null) throw new Error('localStorage token missing');
    const r = await fetch('/v1/agents/claude/exec', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'hello fake' }),
    });
    if (!r.ok) {
      // Read the error body to assert it does not echo the token,
      // then surface the daemon's problem.type / status for the
      // test failure message — never include the bearer in the
      // thrown error.
      let body = '';
      try {
        body = await r.text();
      } catch {
        body = '';
      }
      if (token !== '' && body.includes(token)) {
        throw new Error('exec error body contained the bearer token');
      }
      throw new Error(`exec status ${r.status} ct=${r.headers.get('content-type') ?? ''}`);
    }
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('ndjson') && !ct.includes('json')) {
      throw new Error(`exec content-type = ${ct}`);
    }
    const text = await r.text();
    // Robust line scan: skip blanks and non-JSON, take the first
    // envelope whose payload.session_id is a non-empty string.
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let env: { session_id?: unknown };
      try {
        env = JSON.parse(trimmed) as { session_id?: unknown };
      } catch {
        continue;
      }
      if (typeof env.session_id === 'string' && env.session_id !== '') {
        return env.session_id;
      }
    }
    throw new Error('no envelope with session_id in exec response');
  });

  await page.goto(`/sessions/${sessionId}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Session' })).toBeVisible();
  const messagesContainer = page.getByTestId('session-messages');
  await expect(messagesContainer).toBeVisible();
  // happy.jsonl fake fixture content — assert both message bodies
  // are visible (renders through MessageText / SessionDetailPage).
  await expect(
    messagesContainer.getByText("Hello! I'll help you implement that feature.", { exact: false }),
  ).toBeVisible();
  await expect(
    messagesContainer.getByText('All done. Closing out.', { exact: false }),
  ).toBeVisible();
  // session_ended terminal state visible as a status row.
  await expect(page.getByTestId('status-row-session_ended')).toBeVisible();
});
