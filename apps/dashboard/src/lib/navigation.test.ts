import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, activeNavItem, isItemActive } from './navigation';

describe('NAV_ITEMS / activeNavItem (Stage B1)', () => {
  it('exposes the six product pages in display order', () => {
    expect(NAV_ITEMS.map((n) => n.to)).toEqual([
      '/overview',
      '/agents',
      '/chat',
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

  it('Overview / Agents / Chat / Tokens / Settings match exact paths only', () => {
    for (const path of ['/overview', '/agents', '/chat', '/tokens', '/settings']) {
      const item = NAV_ITEMS.find((n) => n.to === path);
      expect(item?.matches(path)).toBe(true);
      expect(item?.matches(`${path}/x`)).toBe(false);
    }
  });

  it('activeNavItem picks the page that owns the current pathname', () => {
    expect(activeNavItem('/overview')?.to).toBe('/overview');
    expect(activeNavItem('/chat')?.to).toBe('/chat');
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

describe('NAV_GROUPS / isItemActive', () => {
  it('exposes two groups: Dashboard (5 items) and System (1 item)', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Dashboard', 'System']);
    expect(NAV_GROUPS[0]?.items.map((i) => i.to)).toEqual([
      '/overview',
      '/agents',
      '/chat',
      '/sessions',
      '/tokens',
    ]);
    expect(NAV_GROUPS[1]?.items.map((i) => i.to)).toEqual(['/settings']);
  });

  it('NAV_ITEMS is derived from NAV_GROUPS in declared order', () => {
    const flat = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.to);
    expect(NAV_ITEMS.map((i) => i.to)).toEqual(flat);
  });

  it('isItemActive matches a NavItem against a pathname (preserves /sessions/:id highlight)', () => {
    const sessions = NAV_ITEMS.find((n) => n.to === '/sessions');
    if (!sessions) throw new Error('expected Sessions nav item');
    expect(isItemActive(sessions, '/sessions')).toBe(true);
    expect(isItemActive(sessions, '/sessions/abc')).toBe(true);
    expect(isItemActive(sessions, '/agents')).toBe(false);
  });
});
