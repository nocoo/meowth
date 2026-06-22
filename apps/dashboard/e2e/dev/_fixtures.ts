import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// Token handoff between scripts/e2e-dev-fixture.ts and the dev
// specs. The fixture writes the freshly minted mwt_... root
// token to TOKEN_FILE_PATH with mode 0600 and deletes the file
// on process exit / SIGINT / SIGTERM. Specs only read; never
// log; never copy to repo.

export const TOKEN_FILE_PATH = join(tmpdir(), 'meowth-e2e-dev-token');

export function readRootToken(): string {
  if (!existsSync(TOKEN_FILE_PATH)) {
    throw new Error(`e2e dev fixture did not produce ${TOKEN_FILE_PATH}`);
  }
  const value = readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
  if (!value.startsWith('mwt_')) {
    throw new Error('e2e dev fixture token file does not look like an mwt_ token');
  }
  return value;
}

export async function handpasteToken(page: Page): Promise<void> {
  const token = readRootToken();
  await page.goto('/');
  // Missing token → AuthGate redirects to /setup.
  await page.waitForURL(/\/setup$/);
  await page.locator('input[type=password]').first().fill(token);
  await page.getByRole('button', { name: /Continue/i }).click();
  await page.waitForURL(/\/overview$/);
}
