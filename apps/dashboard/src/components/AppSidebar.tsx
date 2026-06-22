import { cn } from '@/lib/utils';
import { Bot, KeyRound, LayoutDashboard, ListTree, Settings as SettingsIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';

// docs/architecture/06 §4.1.2: meowth-local AppSidebar (not a
// verbatim basalt copy). Five product pages plus the Setup link
// for unauthenticated visitors. No i18n, no command palette, no
// LanguageToggle — those features sit outside v1.
//
// docs/architecture/06 §7.3 places /sessions/:id under the
// Sessions menu item, so the active-state predicate matches
// `/sessions` AND `/sessions/<id>`.

type SidebarItem = {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  // matches() returns true when the current pathname belongs to
  // this nav entry. We pass it instead of relying on NavLink's
  // own end/start matching so /sessions/:id stays under Sessions.
  matches: (pathname: string) => boolean;
};

const ITEMS: SidebarItem[] = [
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

export default function AppSidebar() {
  const { pathname } = useLocation();
  const setupActive = pathname === '/setup';
  return (
    <nav
      aria-label="Primary"
      className="bg-card text-card-foreground flex h-screen w-56 shrink-0 flex-col gap-1 border-r p-3"
    >
      <div className="text-foreground px-2 py-3 text-base font-semibold">Meowth</div>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = item.matches(pathname);
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
                  active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'hover:bg-secondary/60 text-muted-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto">
        <NavLink
          to="/setup"
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-2 text-xs',
            setupActive
              ? 'bg-secondary text-secondary-foreground'
              : 'hover:bg-secondary/60 text-muted-foreground',
          )}
          aria-current={setupActive ? 'page' : undefined}
        >
          Setup
        </NavLink>
      </div>
    </nav>
  );
}
