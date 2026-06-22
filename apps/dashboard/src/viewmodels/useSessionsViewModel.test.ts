import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useSessionsViewModel from './useSessionsViewModel';

describe('useSessionsViewModel', () => {
  it('returns the idle skeleton shape', () => {
    const { result } = renderHook(() => useSessionsViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.sessions).toEqual([]);
  });
});
