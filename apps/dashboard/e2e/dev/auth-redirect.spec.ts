import { expect, test } from '@playwright/test';

// docs/architecture/08-6dq-hooks-wiring.md §4 (c) — 401 redirect:
// AuthGate probes /v1/agents with a syntactically valid but
// unauthorized bearer; daemon returns 401; the gate clears the
// stored token and redirects to /setup. Tests the actual 401
// path, not just the missing-token branch (no-token redirect is
// already covered implicitly by handpasteToken).

const BAD_TOKEN = `mwt_${'A'.repeat(39)}`;

test('an unauthorized stored token is cleared and redirects to /setup', async ({ page }) => {
  // Seed localStorage with a syntactically valid but unauthorized
  // bearer. AuthGate has to actually probe /v1/agents to discover
  // that it is rejected.
  await page.goto('/setup');
  await page.evaluate((token) => {
    window.localStorage.setItem('meowth_token', token);
  }, BAD_TOKEN);

  await page.goto('/agents');
  await page.waitForURL(/\/setup$/);

  const tokenAfter = await page.evaluate(() => window.localStorage.getItem('meowth_token'));
  expect(tokenAfter).toBeNull();
});
