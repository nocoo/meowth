import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useAgentsViewModel from './useAgentsViewModel';

describe('useAgentsViewModel', () => {
  it('returns the idle skeleton shape', () => {
    const { result } = renderHook(() => useAgentsViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.agents).toEqual([]);
  });
});
