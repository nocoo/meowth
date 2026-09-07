import { expect, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

const CODE = 'const total = 2 + 2;\nconsole.log(total);';
const RICH_REPLY = [
  '## Rendering check',
  '**Completed** with *consistent typography* and `inline code`.',
  '- Clear spacing\n- Nested content\n  - A second level',
  '> The response stays readable in both themes.',
  `\`\`\`typescript\n${CODE}\n\`\`\``,
  '| Left | Center | Right |\n| :--- | :---: | ---: |\n| Basalt | Ready | 42 |',
  '- [x] Formatting verified',
].join('\n\n');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test.describe(`${theme} ${width}px`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: 960 } });

      test('chat renders and copies rich agent output', async ({ page, context }, testInfo) => {
        await mockDashboard(page);
        await page.route('**/v1/agents/*/exec', (route) => {
          const base = { v: 1, ts: '2026-09-08T08:00:00Z', session_id: 'rich-session' };
          const events = [
            { ...base, seq: 0, type: 'session_started', payload: {} },
            {
              ...base,
              seq: 1,
              type: 'message',
              payload: { kind: 'text', content: RICH_REPLY.slice(0, 100) },
            },
            {
              ...base,
              seq: 2,
              type: 'message',
              payload: { kind: 'text', content: RICH_REPLY.slice(100) },
            },
            {
              ...base,
              seq: 3,
              type: 'session_ended',
              payload: { status: 'completed', duration_ms: 1200 },
            },
          ];
          return route.fulfill({
            contentType: 'application/x-ndjson',
            body: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
          });
        });
        await page.goto('/chat');
        await page
          .getByRole('textbox', { name: 'Message', exact: true })
          .fill('Show a formatting sample');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        const reply = page.locator('[data-bubble-kind="text"]');
        await expect(
          reply.getByRole('heading', { name: 'Rendering check', level: 2 }),
        ).toBeVisible();
        await expect(reply.locator('strong')).toHaveText('Completed');
        const weight = await reply
          .locator('strong')
          .evaluate((element) => Number(getComputedStyle(element).fontWeight));
        expect(weight).toBeGreaterThanOrEqual(600);
        await expect(reply.getByRole('cell', { name: 'Basalt' })).toHaveCSS('text-align', 'left');
        await expect(reply.getByRole('cell', { name: 'Ready' })).toHaveCSS('text-align', 'center');
        await expect(reply.getByRole('cell', { name: '42' })).toHaveCSS('text-align', 'right');
        await expect(reply.getByRole('checkbox')).toBeChecked();
        await expect(reply.getByRole('checkbox')).toBeDisabled();
        expect(
          await reply.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        expect(
          await page
            .locator('[data-basalt-surface-root]')
            .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);

        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await reply.getByRole('button', { name: 'Copy code' }).click();
        await expect(reply.getByText('Copied', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
        await page.screenshot({
          path: testInfo.outputPath('rich-chat.png'),
          animations: 'disabled',
        });
      });
    });
  }
}
