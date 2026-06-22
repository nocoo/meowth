import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/07 §11 L3 (b) — XSS render-path spec.
//
// Drives an untrusted text payload through the real
// /v1/agents/claude/exec NDJSON write → SQLite store → GET
// /v1/sessions/<id>/messages snapshot → MessageText render pipeline.
// The payload is supplied by the test via the fake backend's
// PromptMarkerXSSPayload marker (see
// daemon/internal/server/testbackend/testbackend.go) so we do not
// have to add a non-test "echo" mode to a real backend.
//
// Assertions are tight to the payload, not "any script tag", because
// the dashboard's index.html legitimately loads bundled module
// scripts.

const PAYLOAD_SCRIPT = '<script data-meowth-xss>window.__meowthXssFired=true</script>';
const PAYLOAD_IMG = '<img src=x onerror="window.__meowthXssOnerror=true" data-meowth-xss>';
const PROMPT_SCRIPT = `MEOWTH_E2E_XSS_PAYLOAD:${PAYLOAD_SCRIPT}`;
const PROMPT_IMG = `MEOWTH_E2E_XSS_PAYLOAD:${PAYLOAD_IMG}`;

async function execWithPrompt(
  page: import('@playwright/test').Page,
  prompt: string,
): Promise<string> {
  return page.evaluate(async (p: string) => {
    const token = window.localStorage.getItem('meowth_token');
    if (token === null) throw new Error('localStorage token missing');
    const r = await fetch('/v1/agents/claude/exec', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: p }),
    });
    if (!r.ok) throw new Error(`exec status ${r.status}`);
    const text = await r.text();
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
  }, prompt);
}

test('payload <script> is rendered as text, not executed', async ({ page }) => {
  // Pre-arm: any `alert()` is a hard failure. Dashboard never
  // legitimately calls alert(), so an unexpected dialog is XSS.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });

  await handpasteToken(page);
  const sessionId = await execWithPrompt(page, PROMPT_SCRIPT);

  await page.goto(`/sessions/${sessionId}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Session' })).toBeVisible();
  const messagesContainer = page.getByTestId('session-messages');
  await expect(messagesContainer).toBeVisible();

  // Wait for the payload's literal characters to render. The
  // dashboard inserts text nodes, so `<script>` shows up verbatim in
  // textContent.
  await expect(messagesContainer).toContainText('<script data-meowth-xss>');

  // No script tag with our marker attribute may exist anywhere in
  // the document — querySelector hits both attached <script> tags
  // and the not-yet-evaluated form a parser would produce.
  const injectedCount = await page.evaluate(
    () => document.querySelectorAll('script[data-meowth-xss]').length,
  );
  expect(injectedCount).toBe(0);

  // Flag the payload would have set, had it executed.
  const fired = await page.evaluate(
    () => (window as unknown as { __meowthXssFired?: boolean }).__meowthXssFired === true,
  );
  expect(fired).toBe(false);

  // No alert / confirm / prompt dialogs were triggered while
  // rendering the payload.
  expect(dialogs).toHaveLength(0);
});

test('payload <img onerror> is rendered as text, not parsed into an executing img', async ({
  page,
}) => {
  await handpasteToken(page);
  const sessionId = await execWithPrompt(page, PROMPT_IMG);

  await page.goto(`/sessions/${sessionId}`);
  const messagesContainer = page.getByTestId('session-messages');
  await expect(messagesContainer).toBeVisible();
  await expect(messagesContainer).toContainText('<img src=x');

  // No img element with the marker attribute or an onerror handler
  // pointing at our flag may exist in the document.
  const injectedImg = await page.evaluate(
    () => document.querySelectorAll('img[data-meowth-xss], img[onerror]').length,
  );
  expect(injectedImg).toBe(0);

  const fired = await page.evaluate(
    () => (window as unknown as { __meowthXssOnerror?: boolean }).__meowthXssOnerror === true,
  );
  expect(fired).toBe(false);
});
