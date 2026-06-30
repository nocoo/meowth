import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/features/03 task #22 — happy-path Chat e2e against the
// dev fixture's fake backend factory (testbackend, scenario
// "happy" for the claude type). The fixture sets
// MEOWTH_BACKEND_FACTORY=fake on the serve process, so
// /v1/agents reports five installed backends and an exec call
// replays `fixtures/happy.jsonl` content verbatim.
//
// Coverage rationale (see L1 + L2 already in place):
//   - cancel/abort taxonomy is L1-covered (useChatViewModel tests)
//   - §3.3 resume-id propagation is L1 + L2 covered (chat L2)
// This spec proves the route is wired, the picker lists installed
// backends, a streamed reply renders the fixture's real text, and
// the composer unlocks after session_ended — the pieces that
// only an end-to-end render-path test can prove.

test('chat: navigates to /chat, picker lists installed backends', async ({ page }) => {
  await handpasteToken(page);
  await page.getByRole('link', { name: 'Chat' }).click();
  await page.waitForURL(/\/chat$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Chat' })).toBeVisible();
  const picker = page.getByRole('combobox', { name: 'Backend agent' });
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(page.getByRole('option', { name: 'claude' })).toBeVisible();
});

test('chat: sends a prompt and renders the streamed happy-fixture reply', async ({ page }) => {
  await handpasteToken(page);
  await page.getByRole('link', { name: 'Chat' }).click();
  await page.waitForURL(/\/chat$/);

  await page.getByRole('textbox', { name: 'Message' }).fill('hello from e2e');
  await page.getByRole('button', { name: 'Send' }).click();

  // The happy fixture streams two text envelopes; assert the
  // verbatim payloads rendered so the streamed-render path is
  // genuinely exercised, not only the bubble container.
  await expect(page.getByText("Hello! I'll help you implement that feature.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('All done. Closing out.')).toBeVisible({ timeout: 10_000 });

  // The session_ended footer is the terminal signal; the
  // SessionEndedFooter component formats happy as "✓ completed
  // in <duration>" (the happy fixture sets duration_ms=42, so
  // the footer shows "✓ completed in 42ms").
  const footer = page.locator('[data-bubble-kind="session-ended"]');
  await expect(footer).toBeVisible({ timeout: 10_000 });
  await expect(footer).toContainText('✓ completed');
});

test('chat: composer flips back to Send after session_ended', async ({ page }) => {
  await handpasteToken(page);
  await page.getByRole('link', { name: 'Chat' }).click();
  await page.waitForURL(/\/chat$/);

  await page.getByRole('textbox', { name: 'Message' }).fill('one');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-bubble-kind="session-ended"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});
