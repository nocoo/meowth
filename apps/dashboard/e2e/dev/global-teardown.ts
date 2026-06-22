import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright globalTeardown for the dev L3 fixture.
//
// Runs after all specs even if Playwright SIGKILL'd the webServer
// child (signal handlers inside scripts/e2e-dev-fixture.ts do not
// fire on SIGKILL). Removes the token file at OS temp and the
// throw-away MEOWTH_TEST_HOME the fixture wrote a marker for.
//
// Defense-in-depth with the fixture's startup-time stale unlink;
// this is the primary guarantee that a token artifact never
// outlives a test run on this machine.

const TOKEN_FILE_PATH = join(tmpdir(), 'meowth-e2e-dev-token');
const HOME_MARKER_PATH = join(tmpdir(), 'meowth-e2e-dev-home-path');

export default async function globalTeardown(): Promise<void> {
  if (existsSync(TOKEN_FILE_PATH)) {
    try {
      unlinkSync(TOKEN_FILE_PATH);
    } catch {
      // best effort
    }
  }
  if (existsSync(HOME_MARKER_PATH)) {
    let homePath = '';
    try {
      homePath = readFileSync(HOME_MARKER_PATH, 'utf8').trim();
    } catch {
      // ignore
    }
    if (homePath !== '' && existsSync(homePath)) {
      try {
        rmSync(homePath, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    try {
      unlinkSync(HOME_MARKER_PATH);
    } catch {
      // best effort
    }
  }
}
