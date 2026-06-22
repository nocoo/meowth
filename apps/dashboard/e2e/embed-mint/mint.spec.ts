import { expect, test } from '@playwright/test';
import { pasteAndMint } from './_fixtures';

// docs/architecture/06 §11 (b) + 04 §4 — embed mint happy path B:
//   meowthd init --skip-token → mint window OPEN → paste setup-code
//   at same-origin /setup mint form → mint → /overview render →
//   freshly stored bearer authenticates /v1/agents (rendered via
//   the Agents page).
//
// Single spec because the first-run mint window is one-shot
// (consumed by the first successful mint); a second mint in the
// same daemon process would fail with 404. We assert /overview and
// /agents in one flow so the bearer is exercised end-to-end.

test('paste setup-code → mint → /overview → /agents authenticates', async ({ page }) => {
  await pasteAndMint(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await page.getByRole('link', { name: /Agents/ }).click();
  await page.waitForURL(/\/agents$/);
  // Fake backend → all 5 backends installed; assert one as a
  // smoke check that the stored bearer survived the mint flow.
  await expect(page.getByRole('cell', { name: 'claude' }).first()).toBeVisible();
});
