import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// 3.22 light coverage of the Create token dialog: dialog opens,
// dialog closes, the new row name appears in the table. Plaintext
// secret reveal / copy / storage assertions are deferred to 3.24
// (07 §11 L3 (f)).

test('Create token via dashboard reveals the new row by name (no plaintext check)', async ({
  page,
}) => {
  await handpasteToken(page);
  await page.getByRole('link', { name: /Tokens/ }).click();
  await page.waitForURL(/\/tokens$/);
  await page.getByRole('button', { name: /Create token/i }).click();
  const dialog = page.getByRole('dialog', { name: /Create token/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Name/).fill('ci-bot-22');
  await dialog.getByRole('button', { name: /^Create$/ }).click();
  // The reveal phase shows "Token created" header; close without
  // touching Reveal/Copy.
  await expect(page.getByRole('heading', { name: /Token created/ })).toBeVisible();
  await page.getByRole('button', { name: /^Done$/ }).click();
  // Dialog closes; new token row visible in the table.
  await expect(page.getByRole('cell', { name: 'ci-bot-22' })).toBeVisible();
});
