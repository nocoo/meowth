import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, activeNavItem } from './navigation';

describe('NAV_ITEMS / activeNavItem (Stage B1)', () => {
  it('exposes the five product pages in display order', () => {
    expect(NAV_ITEMS.map((n) => n.to)).toEqual([
      '/overview',
      '/agents',
      '/sessions',
      '/tokens',
      '/settings',
    ]);
  });

  it('does not include /setup (rendered outside the AppShell)', () => {
    expect(NAV_ITEMS.find((n) => n.to === '/setup')).toBeUndefined();
  });

  it('Sessions matches both /sessions and /sessions/<id>', () => {
    const sessions = NAV_ITEMS.find((n) => n.to === '/sessions');
    expect(sessions?.matches('/sessions')).toBe(true);
    expect(sessions?.matches('/sessions/019e-abc')).toBe(true);
    expect(sessions?.matches('/sessions-other')).toBe(false);
  });

  it('Overview / Agents / Tokens / Settings match exact paths only', () => {
    for (const path of ['/overview', '/agents', '/tokens', '/settings']) {
      const item = NAV_ITEMS.find((n) => n.to === path);
      expect(item?.matches(path)).toBe(true);
      expect(item?.matches(`${path}/x`)).toBe(false);
    }
  });

  it('activeNavItem picks the page that owns the current pathname', () => {
    expect(activeNavItem('/overview')?.to).toBe('/overview');
    expect(activeNavItem('/sessions/abc')?.to).toBe('/sessions');
    expect(activeNavItem('/unknown')).toBeUndefined();
  });

  it('every nav item carries a label and a lucide-react icon', () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.Icon).toBe('object'); // lucide icons are forwardRef objects
    }
  });
});
