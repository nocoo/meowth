import { describe, expect, it } from 'vitest';
import { greet } from './index';

describe('shared L1 harness placeholder (Phase 2.7)', () => {
  it('greet returns the formatted greeting', () => {
    expect(greet('shared')).toBe('Hello, shared!');
  });
});
