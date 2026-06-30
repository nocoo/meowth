import {
  Bot,
  KeyRound,
  LayoutDashboard,
  ListTree,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

// Pure-data navigation table for the Gen 2 sidebar. Driven by
// `components/layout/sidebar.tsx`; tests assert this list end-to-end
// rather than reaching into the rendered DOM, so future page
// additions stay obvious in code review.
//
// Expanded sidebar uses NAV_GROUPS for the grouped layout (matches
// surety's "label + grouped block" visual). Collapsed sidebar uses
// NAV_ITEMS (a flat rail) so the icon list stays compact and
// group labels are hidden.
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

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

const OVERVIEW: NavItem = {
  to: '/overview',
  label: 'Overview',
  Icon: LayoutDashboard,
  matches: (p) => p === '/overview',
};
const AGENTS: NavItem = {
  to: '/agents',
  label: 'Agents',
  Icon: Bot,
  matches: (p) => p === '/agents',
};
const CHAT: NavItem = {
  to: '/chat',
  label: 'Chat',
  Icon: MessageSquare,
  matches: (p) => p === '/chat',
};
const SESSIONS: NavItem = {
  to: '/sessions',
  label: 'Sessions',
  Icon: ListTree,
  matches: (p) => p === '/sessions' || p.startsWith('/sessions/'),
};
const TOKENS: NavItem = {
  to: '/tokens',
  label: 'Tokens',
  Icon: KeyRound,
  matches: (p) => p === '/tokens',
};
const SETTINGS: NavItem = {
  to: '/settings',
  label: 'Settings',
  Icon: SettingsIcon,
  matches: (p) => p === '/settings',
};

// Grouped navigation for the expanded sidebar. Group labels are
// kept generic ("Dashboard" / "System") so they document intent
// without inventing fake product features. Add a new group only
// when an actual product surface (not just a single page) needs
// its own visual section.
export const NAV_GROUPS: readonly NavGroup[] = [
  { label: 'Dashboard', items: [OVERVIEW, AGENTS, CHAT, SESSIONS, TOKENS] },
  { label: 'System', items: [SETTINGS] },
];

// Flat list for the collapsed sidebar rail. Derived from
// NAV_GROUPS so the two views stay in sync.
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.matches(pathname));
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  return item.matches(pathname);
}
