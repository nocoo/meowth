import { expect, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

test.use({ viewport: { width: 1440, height: 960 } });

test('all dashboard pages render without runtime errors', async ({ page }) => {
  await mockDashboard(page);
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
    await expect(page.locator('[data-basalt-surface-root]').first()).toBeVisible();
  }

  expect(errors).toEqual([]);
});

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
