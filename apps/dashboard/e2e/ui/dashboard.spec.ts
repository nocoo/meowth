import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { LONG_OUTPUT, mockDashboard } from './fixtures';

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme, viewport: { width: 1440, height: 960 } });

    test.beforeEach(async ({ page }) => {
      await mockDashboard(page);
    });

    test('all dashboard pages render with working assets', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const route of [
        'overview',
        'agents',
        'sessions',
        'sessions/ui-session-1',
        'tokens',
        'settings',
        'chat',
        'setup',
      ]) {
        await page.goto(`/${route}`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('data-mode', theme);
        expect(
          await page.evaluate(() =>
            [...document.images].every((img) => img.complete && img.naturalWidth > 0),
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${route.replaceAll('/', '-')}.png`),
          animations: 'disabled',
        });
      }
      expect(errors).toEqual([]);
    });

    test('navigation and controls share the same readable accent', async ({ page }, testInfo) => {
      await page.goto('/tokens');
      const active = page.getByRole('link', { name: 'Tokens', exact: true });
      const create = page.getByRole('button', { name: 'Create token', exact: true });
      await expect(create).toBeVisible();
      await expect(active).toHaveAttribute('aria-current', 'page');
      const textColor = await active.evaluate((element) => getComputedStyle(element).color);
      const fill = await create.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(textColor).toBe(fill);

      const contrast = await create.evaluate((element) => {
        const luminance = (color: string) => {
          const channels =
            color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number) ?? [];
          const linear = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
        };
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await create.click();
      const dialog = page.getByRole('dialog', { name: 'Create token' });
      await expect(dialog).toHaveCSS('opacity', '1');
      await page.screenshot({
        path: testInfo.outputPath('create-token.png'),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(create).toBeFocused();
    });

    test('sidebar and toolbar icons align and collapsed navigation stays accessible', async ({
      page,
    }) => {
      await page.goto('/overview');
      await expect(page.getByText('Reachable', { exact: true })).toBeVisible();
      const logo = page.getByAltText('Meowth', { exact: true });
      const before = await logo.boundingBox();
      const icons = page.getByRole('navigation', { name: 'Pages' }).locator('a svg');
      const positions = await icons.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            width: rect.width,
            height: rect.height,
            stroke: element.getAttribute('stroke-width'),
          };
        }),
      );
      expect(positions).toHaveLength(6);
      expect(new Set(positions.map((position) => position.x)).size).toBe(1);
      for (const icon of positions) {
        expect([icon.width, icon.height, icon.stroke]).toEqual([16, 16, '1.5']);
      }
      const toolbar = [
        page.getByRole('button', { name: 'Refresh page data' }),
        page.getByRole('link', { name: 'GitHub repository' }),
        page.getByRole('button', { name: /Switch to .* theme/ }),
      ];
      for (const control of toolbar) {
        const box = await control.boundingBox();
        expect([box?.width, box?.height]).toEqual([32, 32]);
      }

      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      const after = await logo.boundingBox();
      expect(after?.y).toBe(before?.y);
      const rail = page.getByRole('complementary', { name: 'Primary navigation' });
      await expect(rail).toHaveCSS('width', '68px');
      const centers = await rail.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const axis = bounds.x + bounds.width / 2;
        const targets = element.querySelectorAll(
          'img, nav a svg, button svg, [data-slot="avatar"]',
        );
        return [...targets].map((target) => {
          const rect = target.getBoundingClientRect();
          return Math.abs(rect.x + rect.width / 2 - axis);
        });
      });
      expect(centers.length).toBeGreaterThanOrEqual(8);
      for (const offset of centers) expect(offset).toBeLessThanOrEqual(0.5);
      await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    test('mobile navigation, tables, and long messages stay within the viewport', async ({
      page,
    }, testInfo) => {
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        for (const route of [
          'overview',
          'agents',
          'sessions',
          'sessions/ui-session-1',
          'tokens',
          'settings',
          'chat',
        ]) {
          await page.goto(`/${route}`);
          await page.waitForLoadState('networkidle');
          const fits = await page
            .locator('[data-basalt-surface-root]')
            .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
          expect(fits, `${route} overflows at ${width}px`).toBe(true);
        }
      }

      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('link', { name: 'Agents', exact: true }).click();
      await expect(page).toHaveURL(/\/agents$/);
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
      await page.goto('/chat');
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('请检查界面');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.locator('[data-bubble-kind="session-ended"]')).toBeVisible();
      const reply = page.locator('[data-bubble-kind="text"]');
      await expect(reply).toHaveText(LONG_OUTPUT);
      await expect(reply.locator('img')).toHaveCount(0);
      expect(
        await reply.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('chat-mobile.png'),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'New chat' }).click();
      await expect(page.getByText('Start a conversation.', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
    });
  });
}

test('empty states keep navigation and actions usable', async ({ page }) => {
  await mockDashboard(page, { agents: [], sessions: [], tokens: [] });
  await page.goto('/overview');
  await expect(page.getByText('No sessions yet', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open chat', exact: true }).click();
  await expect(page.getByText('No agents installed', { exact: true })).toBeVisible();
  await page.goto('/tokens');
  await expect(page.getByText('No tokens yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create token', exact: true })).toBeEnabled();
});

test('Vite applies CSS changes without reloading the document or losing a draft', async ({
  page,
}) => {
  await mockDashboard(page);
  await page.goto('/chat');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep this unsent draft');
  const sentinel = randomUUID();
  await page.locator('html').evaluate((element, value) => {
    element.setAttribute('data-hmr-document', value);
  }, sentinel);
  // Vite deliberately excludes test-results from its file watcher.
  const filename = resolve(DASHBOARD_ROOT, '.playwright', `hmr-${sentinel}.css`);
  const href = `/${relative(DASHBOARD_ROOT, filename).split(sep).map(encodeURIComponent).join('/')}`;
  await mkdir(dirname(filename), { recursive: true });
  try {
    await writeFile(filename, ':root { --meowth-hmr-probe: before; }\n');
    await page.evaluate((url) => import(url), href);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--meowth-hmr-probe').trim(),
        ),
      )
      .toBe('before');
    await writeFile(filename, ':root { --meowth-hmr-probe: after; }\n');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--meowth-hmr-probe').trim(),
        ),
      )
      .toBe('after');
    await expect(page.locator('html')).toHaveAttribute('data-hmr-document', sentinel);
    await expect(draft).toHaveValue('Keep this unsent draft');
  } finally {
    await rm(filename, { force: true });
  }
});
