import { expect, type Page, type Route, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

function complete(route: Route, text: string, id: string) {
  const base = { v: 1, ts: '2026-09-08T08:00:00Z', session_id: id };
  const events = [
    { ...base, seq: 0, type: 'session_started', payload: {} },
    { ...base, seq: 1, type: 'message', payload: { kind: 'text', content: text } },
    {
      ...base,
      seq: 2,
      type: 'session_ended',
      payload: { status: 'completed', backend_session_id: `context-${id}`, duration_ms: 20 },
    },
  ];
  return route.fulfill({
    contentType: 'application/x-ndjson',
    body: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  });
}

async function submit(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test.describe('desktop chat workspace', () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test('retains conversation history and resumes the selected agent context', async ({ page }) => {
    await mockDashboard(page);
    const requests: { prompt: string; resume_session_id?: string }[] = [];
    await page.route('**/v1/agents/*/exec', (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      return complete(route, `Reply to **${body.prompt}**`, String(requests.length));
    });
    await page.goto('/chat');
    await submit(page, 'First Claude question');
    const log = page.getByRole('log', { name: 'Conversation' });
    await expect(log.getByText('First Claude question', { exact: true })).toHaveCount(2);
    await page.getByRole('combobox', { name: 'Choose agent' }).click();
    await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await expect(log.getByText('What can we work on?')).toBeVisible();
    await submit(page, 'Second Codex question');
    await expect(log.locator('[data-bubble-kind="session-ended"]')).toContainText('Completed');
    const inbox = page.getByRole('navigation', { name: 'Conversations' });
    await expect(inbox.getByRole('button')).toHaveCount(2);
    await inbox.getByRole('button', { name: /First Claude question/ }).click();
    await expect(page.getByRole('combobox', { name: 'Choose agent' })).toContainText('Claude');
    await submit(page, 'Continue Claude');
    await expect(log.getByRole('article')).toHaveCount(2);
    expect(requests.map((request) => request.resume_session_id)).toEqual([
      undefined,
      undefined,
      'context-1',
    ]);
  });

  test('shows a transport failure with a usable Retry action', async ({ page }) => {
    await mockDashboard(page);
    let attempt = 0;
    await page.route('**/v1/agents/*/exec', (route) => {
      attempt += 1;
      return attempt === 1
        ? route.fulfill({
            status: 503,
            json: {
              type: '/problems/backend_unavailable',
              title: 'Backend unavailable',
              status: 503,
            },
          })
        : complete(route, 'Connected again', 'recovered');
    });
    await page.goto('/chat');
    await submit(page, 'Recover this question');
    await expect(page.getByRole('alert')).toContainText('Backend unavailable');
    await page.getByRole('button', { name: 'Retry response' }).click();
    await expect(page.getByRole('log').getByText('Connected again')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
