import { greet } from '@meowth/shared';
import { describe, expect, it } from 'vitest';

describe('dashboard L1 harness placeholder (Phase 2.7)', () => {
  it('vitest is wired and @meowth/shared resolves through the workspace alias', () => {
    expect(greet('vitest')).toBe('Hello, vitest!');
  });
});
