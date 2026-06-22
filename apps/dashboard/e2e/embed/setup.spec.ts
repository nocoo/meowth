import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/06 §11 (a) — embed happy path A:
//   meowthd init → paste token at same-origin /setup → /overview
//   renders → /agents lists the 5 fake backends from
//   MEOWTH_BACKEND_FACTORY=fake.

test('handpaste token → /overview → /agents lists 5 fake backends', async ({ page }) => {
  await handpasteToken(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await page.getByRole('link', { name: /Agents/ }).click();
  await page.waitForURL(/\/agents$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Agents' })).toBeVisible();
  for (const t of ['claude', 'copilot', 'codex', 'hermes', 'pi']) {
    await expect(page.getByRole('cell', { name: t }).first()).toBeVisible();
  }
});
