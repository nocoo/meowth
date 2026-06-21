import { describe, expect, it } from 'vitest';
import { cn } from './utils';

// docs/architecture/06 §4.1.1: lib/utils.ts is a verbatim
// source-copy from basalt. These tests are the meowth-side
// smoke check that the copy resolves through the @meowth/
// dashboard tooling, NOT a behavioural spec of cn() itself —
// the contract belongs to basalt + clsx + tailwind-merge
// upstream.
describe('cn() — verbatim source-copy from basalt', () => {
  it('passes through a single class name unchanged', () => {
    expect(cn('p-4')).toBe('p-4');
  });

  it('joins multiple class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('honours tailwind-merge dedup (later class wins on same axis)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('skips falsy entries from clsx', () => {
    const isOn = false;
    expect(cn('always', isOn && 'maybe', null, undefined, 'tail')).toBe('always tail');
  });

  it('merges variant + override Tailwind class lists', () => {
    expect(cn('text-sm font-semibold', 'text-base')).toBe('font-semibold text-base');
  });
});
