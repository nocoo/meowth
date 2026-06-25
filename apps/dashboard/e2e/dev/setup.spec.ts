import { expect, test } from '@playwright/test';
import { handpasteToken } from './_fixtures';

// docs/architecture/08-6dq-hooks-wiring.md §4 (a) — handpaste
// token path A: paste mwt_... root token at /setup, AuthGate
// probes /v1/agents, navigates to /overview, page renders
// product nav.
//
// Stage B1 (Phase 2 redesign) replaced the Gen 1 `<nav aria-label
// ="Primary">` Sidebar with the Gen 2 `<aside aria-label="Primary
// navigation">` shell containing an inner `<nav aria-label
// ="Pages">`. The page-heading assertion stays the same since
// OverviewPage still renders an h2.

test('handpaste token lands on /overview and renders the product nav', async ({ page }) => {
  await handpasteToken(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
});
