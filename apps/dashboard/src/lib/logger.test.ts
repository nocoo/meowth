import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

// logger forwards every argument through redact(safeStringify(...)).
// We spy on the underlying sinks via vi.spyOn(console, ...) so this
// test file never contains a direct `console.<level>(` call (the
// G1 source-scan only allows that in src/lib/logger.ts itself).

type Level = 'info' | 'warn' | 'error' | 'debug';

const LEVELS: Level[] = ['info', 'warn', 'error', 'debug'];

const spies: Record<Level, ReturnType<typeof vi.spyOn>> = {
  info: undefined as never,
  warn: undefined as never,
  error: undefined as never,
  debug: undefined as never,
};

beforeEach(() => {
  for (const lvl of LEVELS) {
    spies[lvl] = vi.spyOn(console, lvl).mockImplementation(() => {
      // swallow; assertions read from spies[lvl].mock.calls
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function firstCallArgs(level: Level): unknown[] {
  const spy = spies[level];
  expect(spy).toHaveBeenCalled();
  return spy.mock.calls[0] ?? [];
}

describe('logger', () => {
  it('info forwards a primitive string verbatim', () => {
    logger.info('hello');
    const args = firstCallArgs('info');
    expect(args).toEqual(['hello']);
  });

  it('redacts an mwt_ token before forwarding to console.warn', () => {
    const tok = `mwt_${'A'.repeat(40)}`;
    logger.warn(`req=${tok}`);
    const args = firstCallArgs('warn');
    expect(args[0]).toBe('req=mwt_<redacted>');
  });

  it('stringifies an Error and redacts an mws_ setup-code inside the message', () => {
    const code = `mws_${'B'.repeat(40)}`;
    const err = new Error(`bad code ${code}`);
    logger.error(err);
    const args = firstCallArgs('error');
    expect(typeof args[0]).toBe('string');
    expect(args[0]).toContain('bad code mws_<redacted>');
    expect(args[0]).not.toContain(code);
  });

  it('debug normalises null / undefined / number / object args to strings', () => {
    logger.debug(undefined, null, 42, { name: 'x' });
    const args = firstCallArgs('debug');
    expect(args).toHaveLength(4);
    for (const a of args) expect(typeof a).toBe('string');
    expect(args).toEqual(['undefined', 'null', '42', '{"name":"x"}']);
  });

  it('redacts the full Authorization header shape inside a stringified object', () => {
    const header = `Authorization: Bearer mwt_${'C'.repeat(40)}`;
    logger.info({ req: header });
    const args = firstCallArgs('info');
    expect(args[0]).toContain('Authorization: Bearer mwt_<redacted>');
    expect(args[0]).not.toContain('CCCCC');
  });
});
