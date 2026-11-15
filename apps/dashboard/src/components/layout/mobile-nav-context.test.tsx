import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MobileNavProvider, useMobileNav } from './mobile-nav-context';

function BareConsumer() {
  useMobileNav();
  return <div />;
}

describe('MobileNavProvider / useMobileNav', () => {
  it('default state: mobileOpen=false', () => {
    const { result } = renderHook(() => useMobileNav(), {
      wrapper: ({ children }) => <MobileNavProvider>{children}</MobileNavProvider>,
    });
    expect(result.current.mobileOpen).toBe(false);
  });

  it('setMobileOpen sets the value directly', () => {
    const { result } = renderHook(() => useMobileNav(), {
      wrapper: ({ children }) => <MobileNavProvider>{children}</MobileNavProvider>,
    });
    act(() => result.current.setMobileOpen(true));
    expect(result.current.mobileOpen).toBe(true);
  });

  it('useMobileNav throws outside a provider', () => {
    expect(() => render(<BareConsumer />)).toThrow(
      'useMobileNav must be used within a MobileNavProvider',
    );
  });
});
