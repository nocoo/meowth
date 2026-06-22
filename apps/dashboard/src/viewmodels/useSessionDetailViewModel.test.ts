import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useSessionDetailViewModel from './useSessionDetailViewModel';

describe('useSessionDetailViewModel', () => {
  it('echoes the supplied sessionId in the idle skeleton shape', () => {
    const id = '019ee83f-661f-715f-b186-2db67a23b559';
    const { result } = renderHook(() => useSessionDetailViewModel(id));
    expect(result.current.status).toBe('idle');
    expect(result.current.sessionId).toBe(id);
    expect(result.current.session).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
});
