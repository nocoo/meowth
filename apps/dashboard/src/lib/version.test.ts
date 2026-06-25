import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './version';

describe('APP_VERSION (Stage B2)', () => {
  it('exposes a non-empty string', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('matches semver-style x.y.z (the dashboard package.json shape)', () => {
    // Build-time substitution from apps/dashboard/package.json.version,
    // which the repo always keeps in semver form. The check is loose
    // enough to allow pre-release suffixes (0.2.0-rc.1) but tight
    // enough to fail if the substitution returns "0.2.0\n" or `${...}`.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
  });

  it('is not the literal undefined / __APP_VERSION__ placeholder', () => {
    expect(APP_VERSION).not.toBe('undefined');
    expect(APP_VERSION).not.toBe('__APP_VERSION__');
  });
});
