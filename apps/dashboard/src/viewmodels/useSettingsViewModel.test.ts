import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useSettingsViewModel from './useSettingsViewModel';

describe('useSettingsViewModel', () => {
  it('returns the idle skeleton shape with daemonReachable unknown', () => {
    const { result } = renderHook(() => useSettingsViewModel());
    expect(result.current.status).toBe('idle');
    expect(result.current.daemonReachable).toBeNull();
  });
});
