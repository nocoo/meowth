import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useTokensViewModel from './useTokensViewModel';

describe('useTokensViewModel', () => {
  it('returns the idle skeleton shape with no transient secret', () => {
    const { result } = renderHook(() => useTokensViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.tokens).toEqual([]);
    expect(result.current.createdSecret).toBeNull();
  });
});
