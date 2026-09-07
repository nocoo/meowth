import { NAV_GROUPS, NAV_ITEMS, type NavGroup, isItemActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
import {
  Avatar,
  AvatarFallback,
  Sidebar as BasaltSidebar,
  Button,
  SidebarFooter,
  SidebarHeader,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@nocoo/basalt';
import { ChevronUp, PanelLeft } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useSidebar } from './sidebar-context';

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const { pathname } = useLocation();
  const isCollapsed = mobile ? false : collapsed;

  return (
    <TooltipProvider delayDuration={0}>
      <BasaltSidebar
        collapsed={isCollapsed}
        aria-label="Primary navigation"
        className={mobile ? 'h-full' : undefined}
      >
        {isCollapsed ? (
          <CollapsedView pathname={pathname} toggle={toggle} />
        ) : (
          <ExpandedView pathname={pathname} toggle={toggle} mobile={mobile} />
        )}
      </BasaltSidebar>
    </TooltipProvider>
  );
}

function CollapsedView({ pathname, toggle }: { pathname: string; toggle: () => void }) {
  return (
    <>
      <SidebarHeader className="justify-start px-0 pl-6 pr-3">
        <img src="/logo-24.png" alt="Meowth" width={24} height={24} className="shrink-0" />
      </SidebarHeader>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mb-2 self-center h-10 w-10"
        onClick={toggle}
        aria-label="Expand sidebar"
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      </Button>

      <SidebarNav aria-label="Pages" className="w-full items-center gap-1 pt-1">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.to} delayDuration={0}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg transition-colors self-center',
                    isActive || isItemActive(item, pathname)
                      ? 'bg-basalt-primary/10 text-basalt-primary'
                      : 'text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground',
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
      </SidebarNav>

      <SidebarFooter className="flex w-full justify-center px-0">
        <Avatar className="h-9 w-9">
          <AvatarFallback>M</AvatarFallback>
        </Avatar>
      </SidebarFooter>
    </>
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
    <>
      <SidebarHeader>
        <div className="flex w-full items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo-24.png" alt="Meowth" width={24} height={24} className="shrink-0" />
            <span className="truncate text-sm font-semibold tracking-tight">Meowth</span>
            <VersionPill />
          </div>
          {mobile ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={toggle}
              aria-label="Collapse sidebar"
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </SidebarHeader>

      <SidebarNav aria-label="Pages" className="pt-1">
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.label} group={group} pathname={pathname} />
        ))}
      </SidebarNav>

      <SidebarFooter>
        <SidebarUser
          name="Meowth"
          email="Local daemon"
          avatar={
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback>M</AvatarFallback>
            </Avatar>
          }
        />
      </SidebarFooter>
    </>
  );
}

function NavGroupSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(true);
  const slug = group.label.toLowerCase();
  return (
    <div className="mt-1 px-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid={`sidebar-group-${slug}`}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <span
          data-testid={`sidebar-group-label-${slug}`}
          className="text-basalt-muted-foreground text-xs font-semibold"
        >
          {group.label}
        </span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <ChevronUp
            className={cn(
              'text-basalt-muted-foreground/50 h-3.5 w-3.5 transition-transform duration-200',
              !open && 'rotate-180',
            )}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
      </button>
      <div
        className="grid overflow-hidden"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease-out',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 px-3">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors',
                    isActive || isItemActive(item, pathname)
                      ? 'bg-basalt-primary/10 font-medium text-basalt-primary'
                      : 'text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground',
                  )
                }
              >
                <item.Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
                <span className="flex-1 text-left">{item.label}</span>
              </NavLink>
            ))}
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
      className="bg-basalt-secondary text-basalt-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10px]"
    >
      v{APP_VERSION}
    </span>
  );
}
