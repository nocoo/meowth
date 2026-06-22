import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, expect } from '@playwright/test';

// Setup-code handoff between scripts/e2e-embed-mint-fixture.ts
// and the embed-mint specs. The fixture writes the freshly minted
// `mws_...` setup-code to CODE_FILE_PATH with mode 0o600 and the
// combined Playwright globalTeardown deletes it after the session.
//
// The code is a secret in the same sense as the bearer token: never
// log it, never throw it back through an Error message, never store
// it in the repo.

export const CODE_FILE_PATH = join(tmpdir(), 'meowth-e2e-embed-mint-code');

export function readSetupCode(): string {
  if (!existsSync(CODE_FILE_PATH)) {
    throw new Error(`e2e embed-mint fixture did not produce ${CODE_FILE_PATH}`);
  }
  const value = readFileSync(CODE_FILE_PATH, 'utf8').trim();
  if (!value.startsWith('mws_')) {
    throw new Error('e2e embed-mint fixture file does not look like an mws_ setup-code');
  }
  return value;
}

export async function pasteAndMint(page: Page): Promise<void> {
  const code = readSetupCode();
  await page.goto('/');
  await page.waitForURL(/\/setup$/);
  // Switch to mint mode (button text: "I have a setup-code instead").
  await page.getByRole('button', { name: /setup-code instead/i }).click();
  // Production embed (same-origin daemon) must enable the Mint
  // button. Guard against accidentally running this spec under
  // the dev mode where the button is disabled per 04 §6.6.
  const mintButton = page.getByRole('button', { name: /Mint token/i });
  await expect(mintButton).toBeEnabled();
  await page.locator('input[type=password]').first().fill(code);
  await mintButton.click();
  await page.waitForURL(/\/overview$/);
}
