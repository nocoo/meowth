import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Combined Playwright globalTeardown.
//
// Cleans both the dev L3 fixture's artifacts (3.20c) and the embed
// L3 fixture's artifacts (3.22). Runs after the test session even
// when Playwright SIGKILL'd the webServer child (signal handlers
// inside the fixture scripts do not fire on SIGKILL).
//
// Defense-in-depth with each fixture's startup-time stale unlink;
// this teardown is the primary guarantee that a token artifact
// never outlives a test run on this machine.

const ARTIFACTS: Array<{ token: string; marker: string }> = [
  {
    token: join(tmpdir(), 'meowth-e2e-dev-token'),
    marker: join(tmpdir(), 'meowth-e2e-dev-home-path'),
  },
  {
    token: join(tmpdir(), 'meowth-e2e-embed-token'),
    marker: join(tmpdir(), 'meowth-e2e-embed-home-path'),
  },
  {
    // 3.23: embed-mint fixture stores the mws_... setup-code in
    // the same secret-handling shape (mode 0o600, OS-temp only,
    // cleaned alongside the other fixtures).
    token: join(tmpdir(), 'meowth-e2e-embed-mint-code'),
    marker: join(tmpdir(), 'meowth-e2e-embed-mint-home-path'),
  },
];

function safeUnlink(p: string): void {
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // best effort
    }
  }
}

function safeRmHomeFromMarker(markerPath: string): void {
  if (!existsSync(markerPath)) return;
  let homePath = '';
  try {
    homePath = readFileSync(markerPath, 'utf8').trim();
  } catch {
    return;
  }
  if (homePath !== '' && existsSync(homePath)) {
    try {
      rmSync(homePath, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  for (const { token, marker } of ARTIFACTS) {
    safeUnlink(token);
    safeRmHomeFromMarker(marker);
    safeUnlink(marker);
  }
}
