import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/02 §5 + 06 §11 (a) — drive a fake agent exec
// against the same-origin daemon, then assert the dashboard
// renders the resulting session's messages via the existing
// snapshot pipeline (06 §7.3).

test('fake claude exec → session detail renders message envelopes', async ({ page }) => {
  await handpasteToken(page);

  // Drive exec from the page so the bearer in localStorage is
  // automatically attached by the model layer. apiFetch isn't
  // directly accessible from page.evaluate, so we replicate its
  // shape: include the bearer header explicitly.
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
      throw new Error(`exec status ${r.status}`);
    }
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('ndjson') && !ct.includes('json')) {
      throw new Error(`exec content-type = ${ct}`);
    }
    const body = await r.text();
    // Robust line scan: ignore blanks, accept the first envelope
    // whose payload carries a session_id (session_started is the
    // typical first, but we don't assume the daemon's order).
    for (const line of body.split('\n')) {
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
  // The fake pump emits at least one envelope rendered as a row.
  // session_started/error/session_ended go through StatusRow with
  // data-testid="status-row-<type>"; message envelopes render via
  // MessageText inside a child div with the seq/ts caption.
  // Assert by visible structure rather than relying on a `pre` tag,
  // which MessageText is free to change.
  const rowCount = await messagesContainer.locator('> div').count();
  expect(rowCount).toBeGreaterThan(0);
});
