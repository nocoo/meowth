import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV_GROUPS, NAV_ITEMS, isItemActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
import { PanelLeft } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { useSidebar } from './sidebar-context';

// Meowth-local Gen 2 Sidebar. Visual + structural alignment with
// surety's components/layout/sidebar.tsx (commit cbf7045f):
//
//   - collapsed view keeps the logo in place at the top
//     (`h-14 pl-6 pr-3 justify-start`) so the brand mark does not
//     shift when the user toggles; the collapse/expand button sits
//     **below** the logo as an independent `h-10 w-10` control
//   - expanded view header uses the surety pattern (`px-3 h-14` +
//     inner `flex w-full items-center justify-between px-3`); the
//     logo block + brand + version pill live in a single row, the
//     toggle is on the right
//   - expanded nav renders NAV_GROUPS (label + grouped block) so
//     the structure documents intent (Dashboard / System) without
//     inventing fake business features. Collapsed nav stays a flat
//     icon rail driven by NAV_ITEMS so the rail stays compact
//   - bottom user section follows surety: collapsed centers an
//     `h-9 w-9` Avatar, expanded shows the same Avatar + two-line
//     name/subtitle. meowth has no real user data, so the labels
//     are static ("Meowth" / "Local daemon")
//
// Out of scope (deferred or not applicable to meowth):
//   - no command palette wiring
//   - no DbSelector (single-store product)
//   - no user dropdown menu
//   - sidebar GitHub link lives in AppShell header, not here
//
// Mobile drawer presentation is provided by `app-shell.tsx`
// wrapping this component in `<Sheet>`. `mobile` prop just
// disables the h-screen/sticky chrome that conflicts with the
// Sheet container and forces the expanded (full-width) layout.

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const { pathname } = useLocation();
  const isCollapsed = mobile ? false : collapsed;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        aria-label="Primary navigation"
        className={cn(
          'bg-background text-foreground sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden',
          mobile && 'h-full',
          isCollapsed ? 'w-[68px]' : 'w-[260px]',
          'transition-[width] duration-150 ease-in-out',
        )}
      >
        {isCollapsed ? (
          <CollapsedView pathname={pathname} toggle={toggle} />
        ) : (
          <ExpandedView pathname={pathname} toggle={toggle} mobile={mobile} />
        )}
      </aside>
    </TooltipProvider>
  );
}

function CollapsedView({ pathname, toggle }: { pathname: string; toggle: () => void }) {
  return (
    <div className="flex h-full w-[68px] flex-col items-center">
      {/* Logo — stays put when the rail collapses (matches surety). */}
      <div className="flex h-14 w-full items-center justify-start pl-6 pr-3">
        <img src="/logo-24.png" alt="Meowth" width={24} height={24} className="shrink-0" />
      </div>

      {/* Expand toggle — sits below the logo as its own h-10 w-10 control. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggle}
            aria-label="Expand sidebar"
            className="text-muted-foreground hover:bg-accent hover:text-foreground mb-2 flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Expand sidebar
        </TooltipContent>
      </Tooltip>

      {/* Flat icon rail — collapsed view uses NAV_ITEMS, no group labels. */}
      <nav
        aria-label="Pages"
        className="flex flex-1 flex-col items-center gap-1 overflow-y-auto pt-1"
      >
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                    isActive || isItemActive(item, pathname)
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <item.Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* User section (collapsed): centered avatar matches surety. */}
      <div className="flex w-full justify-center py-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback>M</AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

function ExpandedView({
  pathname,
  toggle,
  mobile,
}: {
  pathname: string;
  toggle: () => void;
  mobile: boolean;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Header: logo block + (desktop only) collapse toggle. */}
      <div className="flex h-14 items-center px-3">
        <div className="flex w-full items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <img src="/logo-24.png" alt="Meowth" width={24} height={24} className="shrink-0" />
            <span className="text-base font-semibold">Meowth</span>
            <VersionPill />
          </div>
          {mobile ? null : (
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse sidebar"
              className="text-muted-foreground hover:text-foreground flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Grouped navigation. */}
      <nav aria-label="Pages" className="flex-1 overflow-y-auto pt-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mt-2 px-3">
            <div className="px-3 py-2">
              <span
                data-testid={`sidebar-group-label-${group.label.toLowerCase()}`}
                className="text-muted-foreground/70 text-[11px] font-medium"
              >
                {group.label}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 px-3">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors',
                      isActive || isItemActive(item, pathname)
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )
                  }
                >
                  <item.Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
                  <span className="flex-1 text-left">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User section (expanded): avatar + name + subtitle. */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback>M</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">Meowth</p>
            <p className="text-muted-foreground truncate text-xs">Local daemon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function VersionPill() {
  return (
    <span
      data-testid="sidebar-version-pill"
      className="bg-secondary text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10px]"
    >
      v{APP_VERSION}
    </span>
  );
}
