import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useOverviewViewModel from './useOverviewViewModel';

describe('useOverviewViewModel', () => {
  it('returns the idle skeleton shape', () => {
    const { result } = renderHook(() => useOverviewViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.health).toBeNull();
    expect(result.current.tokens).toEqual([]);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.agents).toEqual([]);
  });
});
