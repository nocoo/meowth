import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/08-6dq-hooks-wiring.md §4 (a) — handpaste
// token path A: paste mwt_... root token at /setup, AuthGate
// probes /v1/agents, navigates to /overview, page renders
// product nav.

test('handpaste token lands on /overview and renders the product nav', async ({ page }) => {
  await handpasteToken(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});
