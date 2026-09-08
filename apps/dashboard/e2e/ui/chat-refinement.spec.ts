import { expect, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1024, 390, 320]) {
    test.describe(`refined chat ${theme} ${width}px`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: width === 320 ? 568 : 900 } });

      test('welcomes writing and supports keyboard agent selection', async ({ page }, testInfo) => {
        await mockDashboard(page);
        await page.goto('/chat');
        const composer = page.getByRole('textbox', { name: 'Message', exact: true });
        const picker = page.getByRole('combobox', { name: 'Choose agent' });
        await expect(page.getByRole('heading', { name: 'What can we work on?' })).toBeVisible();
        await expect(composer).toBeInViewport();
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
        const composerBounds = await composer.boundingBox();
        expect(composerBounds?.y).toBeGreaterThan(150);
        await page.screenshot({ path: testInfo.outputPath('welcome.png'), animations: 'disabled' });
        await picker.focus();
        await picker.press('Enter');
        const menu = page.getByRole('listbox');
        await expect(menu).toBeVisible();
        await expect(page.getByRole('option', { name: 'Claude', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        const menuBounds = await menu.boundingBox();
        expect(menuBounds?.x).toBeGreaterThanOrEqual(0);
        expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: testInfo.outputPath('agent-menu.png'),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await expect(picker).toBeFocused();
        await picker.press('Enter');
        await page.keyboard.press('Home');
        await expect(page.getByRole('option', { name: 'Claude', exact: true })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('option', { name: 'Codex', exact: true })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(picker).toHaveText('Codex');
        await expect(composer).toHaveAttribute('placeholder', 'Message Codex…');
        await composer.fill('A draft worth keeping');
        if (width >= 1100) {
          await page.getByRole('button', { name: 'Hide conversations' }).click();
          await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
          await expect(composer).toHaveValue('A draft worth keeping');
          await page.getByRole('button', { name: 'Show conversations' }).click();
          await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
        }
        await expect(composer).toHaveValue('A draft worth keeping');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test.describe(`activity reading ${theme} ${width}px`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: 960 } });

      test('keeps tool output collapsed and preserves expansion while streaming', async ({
        page,
      }, testInfo) => {
        await mockDashboard(page);
        await page.addInitScript(() => {
          const fetch = window.fetch;
          window.fetch = (input, init) => {
            if (!String(input).includes('/exec')) return fetch(input, init);
            const encoder = new TextEncoder();
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    const receive = (event: Event) => {
                      const detail = (event as CustomEvent).detail;
                      if (detail === null) {
                        controller.close();
                        window.removeEventListener('chat-fixture-event', receive);
                      } else {
                        controller.enqueue(encoder.encode(`${JSON.stringify(detail)}\n`));
                      }
                    };
                    window.addEventListener('chat-fixture-event', receive);
                  },
                }),
                { headers: { 'Content-Type': 'application/x-ndjson' } },
              ),
            );
          };
        });
        const emit = async (seq: number, type: string, payload: Record<string, unknown>) => {
          await page.evaluate(
            (detail) => window.dispatchEvent(new CustomEvent('chat-fixture-event', { detail })),
            {
              v: 1,
              seq,
              ts: '2026-09-08T08:00:00Z',
              session_id: 'activity-run',
              type,
              payload,
            },
          );
        };
        await page.goto('/chat');
        await page
          .getByRole('textbox', { name: 'Message', exact: true })
          .fill('Review the layout and explain your changes.');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByLabel('Waiting for response')).toBeVisible();
        await emit(0, 'session_started', {});
        await emit(1, 'message', { kind: 'thinking', content: 'I will check the ' });
        const activity = page.locator('[data-bubble-kind="activity"]');
        await expect(
          activity.getByRole('button', { name: 'Thinking', exact: true }),
        ).toHaveAttribute('aria-expanded', 'false');
        await activity.getByRole('button', { name: 'Thinking', exact: true }).focus();
        await page.keyboard.press('Space');
        await emit(2, 'message', { kind: 'thinking', content: '**layout** and spacing.' });
        await expect(activity.locator('strong')).toHaveText('layout');
        await emit(3, 'message', {
          kind: 'tool-use',
          tool: 'Read',
          call_id: 'read-file',
          input: { path: 'dashboard.css' },
        });
        await expect(activity.getByRole('button', { name: 'Working with 1 tool' })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        const tool = activity.getByRole('button', { name: 'Read', exact: true });
        await tool.click();
        await emit(4, 'message', {
          kind: 'tool-result',
          call_id: 'read-file',
          output: `Layout loaded.\n${'Long output is kept inside the activity detail.\n'.repeat(70)}`,
        });
        await expect(activity.getByRole('button', { name: 'Read', exact: true })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        await expect(activity.getByText(/Layout loaded/)).toBeVisible();
        await emit(5, 'message', {
          kind: 'text',
          content:
            '## A calmer workspace\n\nThe layout now has **clear hierarchy**, comfortable spacing, and a focused input area.\n\n```css\n.chat { max-width: 46rem; }\n```\n\n| Area | Result |\n| :--- | ---: |\n| Typography | Consistent |\n| Tool activity | Collapsed |\n\nEverything is ready for the next conversation.',
        });
        await emit(6, 'session_ended', {
          status: 'completed',
          duration_ms: 1800,
          backend_session_id: 'activity-context',
        });
        await page.evaluate(() =>
          window.dispatchEvent(new CustomEvent('chat-fixture-event', { detail: null })),
        );
        await expect(activity.getByRole('button', { name: 'Used 1 tool' })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        await page.screenshot({
          path: testInfo.outputPath('activity-expanded.png'),
          animations: 'disabled',
        });
        await activity.getByRole('button', { name: 'Used 1 tool' }).click();
        await expect(activity.getByText(/Layout loaded/)).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'A calmer workspace' })).toBeVisible();
        const assistant = page.locator('.chat-response');
        await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath('conversation.png'),
          animations: 'disabled',
        });
      });
    });
  }
}
