import { type Page, type Route, expect, test } from '@playwright/test';
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
    await page.getByRole('combobox', { name: 'Backend agent' }).click();
    await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await expect(log.getByText('Start a conversation.')).toBeVisible();
    await submit(page, 'Second Codex question');
    await expect(log.locator('[data-bubble-kind="session-ended"]')).toContainText('Completed');
    const inbox = page.getByRole('navigation', { name: 'Conversations' });
    await expect(inbox.getByRole('button')).toHaveCount(2);
    await page.getByRole('textbox', { name: 'Search conversations' }).fill('Claude');
    await expect(inbox.getByRole('button')).toHaveCount(1);
    await inbox.getByRole('button', { name: /First Claude question/ }).click();
    await expect(page.getByRole('combobox', { name: 'Backend agent' })).toContainText('Claude');
    await expect(log.getByText('Second Codex question')).toHaveCount(0);
    await submit(page, 'Continue Claude');
    await expect(log.getByRole('article')).toHaveCount(2);
    await expect(
      log.getByRole('article').last().locator('[data-bubble-kind="session-ended"]'),
    ).toContainText('Completed');
    expect(requests.map((request) => request.resume_session_id)).toEqual([
      undefined,
      undefined,
      'context-1',
    ]);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(log.getByText('Start a conversation.')).toBeVisible();
    await expect(inbox.getByRole('button')).toHaveCount(2);
  });

  test('stops a pending request and retries without duplicating the turn', async ({ page }) => {
    await mockDashboard(page);
    let attempt = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/v1/agents/*/exec', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await held;
        await complete(route, 'Late response must be ignored', 'old');
      } else {
        await complete(route, '**Retry succeeded**', 'new');
      }
    });
    try {
      await page.goto('/chat');
      await submit(page, 'Slow question');
      await expect(page.getByLabel('Waiting for response')).toBeVisible();
      const field = page.getByRole('textbox', { name: 'Message', exact: true });
      await field.fill('Next draft');
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(page.getByRole('log').getByText('Stopped', { exact: true })).toBeVisible();
      await expect(field).toHaveValue('Next draft');
      await page.getByRole('button', { name: 'Retry response', exact: true }).click();
      release();
      await expect(page.getByRole('log').getByText('Retry succeeded')).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(1);
      await expect(page.getByText('Late response must be ignored')).toHaveCount(0);
      await expect(field).toHaveValue('Next draft');
    } finally {
      release();
    }
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
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('lets the reader scroll independently while new replies arrive', async ({ page }) => {
    await mockDashboard(page);
    let sequence = 0;
    await page.route('**/v1/agents/*/exec', (route) =>
      complete(
        route,
        Array.from(
          { length: 60 },
          (_, index) => `Paragraph ${index + 1}. Read this at your own pace.`,
        ).join('\n\n'),
        String(++sequence),
      ),
    );
    await page.goto('/chat');
    await submit(page, 'A long response');
    const log = page.getByRole('log');
    await expect(log.locator('[data-bubble-kind="session-ended"]')).toBeVisible();
    await log.evaluate((element) => {
      element.scrollTop = 180;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    const position = await log.evaluate((element) => element.scrollTop);
    await submit(page, 'Another response');
    await expect(log.locator('[data-bubble-kind="session-ended"]')).toHaveCount(2);
    expect(await log.evaluate((element) => element.scrollTop)).toBeCloseTo(position, 0);
    await page.getByRole('button', { name: 'Jump to latest' }).click();
    await expect
      .poll(() =>
        log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
      )
      .toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  });
});

for (const width of [320, 390, 1024]) {
  test.describe(`compact workspace ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('opens and closes the conversation drawer without overflowing the page', async ({
      page,
    }) => {
      await mockDashboard(page);
      await page.goto('/chat');
      await submit(page, 'Compact screen conversation');
      await expect(
        page.getByRole('log').locator('[data-bubble-kind="session-ended"]'),
      ).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Show conversations' });
      await trigger.click();
      const drawer = page.getByRole('dialog');
      await expect(
        drawer.getByRole('button', { name: /Compact screen conversation/ }),
      ).toBeVisible();
      await drawer.getByRole('button', { name: /Compact screen conversation/ }).click();
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(
        await page
          .locator('[data-slot="chat-shell"]')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'New chat', exact: true }).click();
      await expect(page.getByText('Start a conversation.')).toBeVisible();
    });
  });
}
