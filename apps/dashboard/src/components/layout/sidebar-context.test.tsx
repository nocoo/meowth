import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarProvider, useSidebar } from './sidebar-context';

describe('SidebarProvider / useSidebar (Stage B1)', () => {
  it('default state: collapsed=false, mobileOpen=false', () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });
    expect(result.current.collapsed).toBe(false);
    expect(result.current.mobileOpen).toBe(false);
  });

  it('toggle() flips collapsed', () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
  });

  it('setCollapsed sets the value directly', () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });
    act(() => result.current.setCollapsed(true));
    expect(result.current.collapsed).toBe(true);
  });

  it('setMobileOpen sets mobile state', () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });
    act(() => result.current.setMobileOpen(true));
    expect(result.current.mobileOpen).toBe(true);
  });

  it('useSidebar throws outside a provider', () => {
    function BareConsumer() {
      useSidebar();
      return <div />;
    }
    // Render must throw; testing-library propagates the error so
    // we wrap to capture.
    expect(() => render(<BareConsumer />)).toThrow(
      'useSidebar must be used within a SidebarProvider',
    );
    // Avoid an unused-warning lint on `screen`.
    expect(screen).toBeDefined();
  });
});
