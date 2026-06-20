import { test } from '@playwright/test';

// Phase 2.9 placeholder — dashboardDevFixture (08 §3.4.1).
// Real body lands when Vite dev (Phase 3.13+) and daemon HTTP (Phase 3.6)
// are wired; until then the suite is honest-skipped so Playwright finds a
// test but does not pretend the dev L3 flow is exercised.
test.skip('dev fixture suite placeholder — wires Vite dev (3.13+) and daemon HTTP (3.6)', () => {
  // intentionally empty
});
