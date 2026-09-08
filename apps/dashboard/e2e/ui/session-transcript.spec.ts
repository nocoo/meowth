import { expect, test } from '@playwright/test';
import type { Envelope } from '../../src/models/types';
import { mockDashboard } from './fixtures';

const SESSION_ID = 'ui-session-1';
const CODE = 'console.log("session");';
const TOOL_OUTPUT = `${'Recorded tool output.\n'.repeat(250)}Full tool output ends here.\n<img src=x onerror=alert(1)>`;

function event(seq: number, type: Envelope['type'], payload: Record<string, unknown>): Envelope {
  return {
    v: 1,
    seq,
    ts: '2026-09-08T08:00:00Z',
    session_id: SESSION_ID,
    type,
    payload,
  };
}

const EVENTS = [
  event(0, 'session_started', { backend_type: 'claude' }),
  event(1, 'message', { kind: 'thinking', content: 'Checking **the layout**.' }),
  event(2, 'message', {
    kind: 'tool-use',
    tool: 'read_file',
    call_id: 'read-layout',
    input: { path: 'dashboard.css' },
  }),
  event(3, 'message', { kind: 'tool-result', call_id: 'read-layout', output: TOOL_OUTPUT }),
  event(4, 'message', { kind: 'text', content: '## Session re' }),
  event(5, 'heartbeat', {}),
  event(6, 'message', {
    kind: 'text',
    content: `view\n\nThe **shared transcript** preserves readable output.\n\n\`\`\`js\n${CODE}\n\`\`\`\n\n| Item | Count |\n| :--- | ---: |\n| Messages | 22 |`,
  }),
  event(7, 'usage', { models: { claude: { input_tokens: 1234, output_tokens: 56 } } }),
  event(8, 'session_ended', { status: 'completed', duration_ms: 1500 }),
];

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390, 320]) {
    test.describe(`session transcript ${theme} ${width}px`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: 960 } });

      test('reuses Chat Markdown, code copying, and full tool disclosures across snapshot pages', async ({
        page,
        context,
      }, testInfo) => {
        await mockDashboard(page);
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const cursors: (string | null)[] = [];
        await page.route(`**/v1/sessions/${SESSION_ID}/messages**`, async (route) => {
          const afterSeq = new URL(route.request().url()).searchParams.get('after_seq');
          cursors.push(afterSeq);
          const firstPage = afterSeq === null;
          await route.fulfill({
            json: {
              session_id: SESSION_ID,
              events: firstPage ? EVENTS.slice(0, 5) : EVENTS.slice(5),
              next_after_seq: firstPage ? 4 : 8,
              has_more: firstPage,
            },
          });
        });
        await page.goto(`/sessions/${SESSION_ID}`);
        await expect(page.getByRole('heading', { name: 'Session review' })).toBeVisible();
        expect(cursors).toEqual([null, '4']);
        await expect(page.locator('html')).toHaveAttribute('data-mode', theme);
        await expect(page.locator('.chat-response')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)',
        );
        await expect(page.locator('[data-bubble-kind="text"]')).toHaveCount(1);
        await expect(page.locator('.chat-response strong')).toHaveText('shared transcript');
        await expect(page.getByRole('cell', { name: '22', exact: true })).toHaveCSS(
          'text-align',
          'right',
        );
        await page.getByRole('button', { name: 'Copy code', exact: true }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
        await expect(page.getByText('Completed in 1.5s')).toBeVisible();
        await expect(page.getByRole('link', { name: /session details/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Retry response' })).toHaveCount(0);

        const activity = page.getByRole('button', { name: 'Used 1 tool' });
        await expect(activity).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-bubble-kind="tool-result"]')).toHaveCount(0);
        await activity.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText('the layout', { exact: true })).toBeVisible();
        const tool = page.getByRole('button', { name: 'Read file', exact: true });
        await expect(tool).toHaveAttribute('aria-expanded', 'false');
        await tool.click();
        const result = page.locator('[data-bubble-kind="tool-result"]');
        await expect(result).toContainText(TOOL_OUTPUT);
        await expect(result.locator('img')).toHaveCount(0);
        await expect(page.getByText(/truncated/)).toHaveCount(0);
        await activity.click();
        await expect(result).toHaveCount(0);

        const bounds = await page.locator('.chat-reading-column').boundingBox();
        if (width === 1440) expect(bounds?.width).toBe(760);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.getByRole('heading', { name: 'Session', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath('transcript.png'),
          animations: 'disabled',
        });
      });
    });
  }
}
