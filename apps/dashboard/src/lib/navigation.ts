import { Bot, KeyRound, LayoutDashboard, ListTree, Settings as SettingsIcon } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

// Pure-data navigation table for the Gen 2 sidebar. Driven by
// `components/layout/sidebar.tsx`; tests assert this list end-to-end
// rather than reaching into the rendered DOM, so future page
// additions stay obvious in code review.
//
// `/setup` deliberately stays out of this list — Setup is rendered
// outside `<AuthGate>` and the AppShell, so it is not part of the
// primary navigation; legacy AppSidebar.tsx had a bottom "Setup"
// link that this redesign drops.

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  to: string;
  label: string;
  Icon: NavIcon;
  // matches() returns true when the current pathname belongs to
  // this nav entry. Provided in code so a route like
  // /sessions/<id> can stay highlighted under "Sessions".
  matches: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/overview',
    label: 'Overview',
    Icon: LayoutDashboard,
    matches: (p) => p === '/overview',
  },
  {
    to: '/agents',
    label: 'Agents',
    Icon: Bot,
    matches: (p) => p === '/agents',
  },
  {
    to: '/sessions',
    label: 'Sessions',
    Icon: ListTree,
    matches: (p) => p === '/sessions' || p.startsWith('/sessions/'),
  },
  {
    to: '/tokens',
    label: 'Tokens',
    Icon: KeyRound,
    matches: (p) => p === '/tokens',
  },
  {
    to: '/settings',
    label: 'Settings',
    Icon: SettingsIcon,
    matches: (p) => p === '/settings',
  },
];

export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.matches(pathname));
}
