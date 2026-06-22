import { expect, test } from '@playwright/test';
import { handpasteToken, readRootToken } from './_fixtures';

// docs/architecture/07 §11 L3 (c) / §7.1 — SecretReveal full coverage
// at the embed layer:
//
//   1. Modal opens with the secret masked to a bullet string sized
//      to the secret's length (no plaintext in DOM textContent).
//   2. Reveal toggles plaintext into the DOM exactly once.
//   3. Copy writes plaintext to the clipboard, sets the "Copied"
//      feedback, and the clipboard read matches what's shown.
//   4. Done closes the dialog and the document body no longer
//      contains the plaintext secret.
//   5. localStorage.meowth_token is unchanged (still the root token
//      we logged in with) — the new token did not overwrite it.
//   6. No dialog (alert/confirm/prompt) ever exposed the plaintext.

test('Create token → reveal → copy → done leaves no plaintext behind', async ({
  page,
  context,
  browserName,
}) => {
  // Clipboard read/write permissions are Chromium-only in Playwright.
  test.skip(browserName !== 'chromium', 'clipboard permissions require chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:17777',
  });

  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await handpasteToken(page);
  const rootToken = readRootToken();

  await page.getByRole('link', { name: /Tokens/ }).click();
  await page.waitForURL(/\/tokens$/);
  await page.getByRole('button', { name: /Create token/i }).click();

  const dialog = page.getByRole('dialog', { name: /Create token/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Name/).fill('reveal-spec');
  await dialog.getByRole('button', { name: /^Create$/ }).click();
  await expect(page.getByRole('heading', { name: /Token created/ })).toBeVisible();

  // (1) Default masked — value is a bullet string. We don't know
  // the exact length until we Reveal, but we can assert the masked
  // form contains only bullets.
  const valueOutput = page.getByTestId('secret-reveal-value');
  await expect(valueOutput).toBeVisible();
  const masked = (await valueOutput.textContent()) ?? '';
  expect(masked.length).toBeGreaterThan(0);
  expect(masked).toMatch(/^•+$/); // only U+2022 BULLET

  // (2) Reveal → plaintext appears in textContent.
  await page.getByRole('button', { name: /^Reveal$/ }).click();
  const revealed = (await valueOutput.textContent()) ?? '';
  expect(revealed.length).toBe(masked.length);
  // Sanity: the revealed value must look like a token but must NOT
  // equal the root token (it's a fresh secret).
  expect(revealed).toMatch(/^mwt_/);
  expect(revealed).not.toBe(rootToken);
  const plaintext = revealed;

  // (3) Copy → clipboard contains plaintext + Copied feedback.
  await page.getByRole('button', { name: /^Copy$/ }).click();
  await expect(page.getByTestId('secret-reveal-feedback')).toHaveText('Copied');
  const clipboardValue = await page.evaluate(async () => navigator.clipboard.readText());
  expect(clipboardValue).toBe(plaintext);

  // (4) Done → dialog closes, plaintext no longer in DOM.
  await page.getByRole('button', { name: /^Done$/ }).click();
  await expect(page.getByRole('cell', { name: 'reveal-spec' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Create token/i })).toHaveCount(0);

  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain(plaintext);

  // (5) localStorage bearer unchanged. The Tokens page must never
  // swap the active bearer to a freshly-minted token; the user can
  // do that manually if they want, but Create does not.
  const stored = await page.evaluate(() => window.localStorage.getItem('meowth_token'));
  expect(stored).toBe(rootToken);

  // (6) No alert / confirm / prompt was triggered, and certainly
  // none surfaced the plaintext.
  expect(dialogs).toHaveLength(0);
});
