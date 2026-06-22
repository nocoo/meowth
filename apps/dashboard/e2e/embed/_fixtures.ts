import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// Token handoff between scripts/e2e-embed-fixture.ts and the embed
// specs. The fixture writes the freshly minted mwt_... root token
// to TOKEN_FILE_PATH with mode 0o600 and the combined Playwright
// globalTeardown deletes it after the session ends.

export const TOKEN_FILE_PATH = join(tmpdir(), 'meowth-e2e-embed-token');

export function readRootToken(): string {
  if (!existsSync(TOKEN_FILE_PATH)) {
    throw new Error(`e2e embed fixture did not produce ${TOKEN_FILE_PATH}`);
  }
  const value = readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
  if (!value.startsWith('mwt_')) {
    throw new Error('e2e embed fixture token file does not look like an mwt_ token');
  }
  return value;
}

export async function handpasteToken(page: Page): Promise<void> {
  const token = readRootToken();
  await page.goto('/');
  await page.waitForURL(/\/setup$/);
  await page.locator('input[type=password]').first().fill(token);
  await page.getByRole('button', { name: /Continue/i }).click();
  await page.waitForURL(/\/overview$/);
}
