import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { PanelLeft } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSidebar } from './sidebar-context';

// Meowth-local Gen 2 Sidebar. Inspired by surety's
// components/layout/sidebar.tsx (commit cbf7045f) but adapted for
// meowth's simpler product surface:
//
//   - no user data (single-user local product; no useMe/getDisplayName/
//     getAvatarColor); the bottom Avatar always renders the static "M"
//     letter on the L2 surface
//   - no navigation groups / collapsible sections; nav is a flat
//     5-item list (matches meowth's 5 product pages — see
//     `lib/navigation.ts`)
//   - no command palette wiring (deferred per redesign plan §7.2)
//   - no GitHub icon / DbSelector (deferred or out of scope)
//
// Mobile drawer presentation is provided by `app-shell.tsx` wrapping
// this component in `<Sheet>`. `mobile` prop just disables the
// h-screen/sticky chrome that conflicts with the Sheet container.

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const expanded = mobile ? true : !collapsed;
  const width = mobile ? 'w-full' : expanded ? 'w-[260px]' : 'w-[68px]';
  return (
    <TooltipProvider delayDuration={0}>
      <aside
        aria-label="Primary navigation"
        className={cn(
          'bg-background text-foreground flex flex-col gap-1 shrink-0',
          mobile ? 'h-full' : 'sticky top-0 h-screen',
          width,
          'transition-[width] duration-150 ease-in-out',
        )}
      >
        <SidebarHeader expanded={expanded} mobile={mobile} toggle={toggle} />
        <nav aria-label="Pages" className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) =>
            expanded ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                    'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[2px] before:-translate-y-1/2',
                    isActive
                      ? 'bg-accent text-foreground before:bg-primary'
                      : 'text-muted-foreground hover:bg-accent/60 before:bg-transparent',
                  )
                }
              >
                <item.Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ) : (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex h-10 w-10 items-center justify-center rounded-md self-center',
                        isActive
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60',
                      )
                    }
                    aria-label={item.label}
                  >
                    <item.Icon className="h-5 w-5" aria-hidden="true" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ),
          )}
        </nav>
        <div className="mt-auto p-3">
          <Avatar className={expanded ? '' : 'mx-auto'}>
            <AvatarFallback>M</AvatarFallback>
          </Avatar>
        </div>
      </aside>
    </TooltipProvider>
  );
}

interface SidebarHeaderProps {
  expanded: boolean;
  mobile: boolean;
  toggle: () => void;
}

function SidebarHeader({ expanded, mobile, toggle }: SidebarHeaderProps) {
  if (mobile) {
    return (
      <div className="flex h-14 items-center gap-2 px-4">
        <img src="/logo-24.png" alt="Meowth" width={24} height={24} />
        <span className="text-base font-semibold">Meowth</span>
      </div>
    );
  }
  if (expanded) {
    return (
      <div className="flex h-14 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2">
          <img src="/logo-24.png" alt="Meowth" width={24} height={24} />
          <span className="text-base font-semibold">Meowth</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse sidebar"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-14 items-center justify-center">
      <button
        type="button"
        onClick={toggle}
        aria-label="Expand sidebar"
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 w-10 items-center justify-center rounded-md transition-colors"
      >
        <PanelLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
      </button>
    </div>
  );
}
