import BrandMark from '@/components/BrandMark';
import { NAV_GROUPS, NAV_ITEMS, type NavGroup, isItemActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
import {
  Avatar,
  AvatarFallback,
  Sidebar as BasaltSidebar,
  Button,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@nocoo/basalt';
import { PanelLeft } from 'lucide-react';
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
        className={cn('motion-reduce:transition-none', mobile && 'h-full')}
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
        <BrandMark alt="Meowth" />
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
                    'flex h-10 w-10 items-center justify-center self-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basalt-ring motion-reduce:transition-none',
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
      <SidebarHeader className="pl-6 pr-3">
        <div className="flex w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark alt="Meowth" />
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
  const slug = group.label.toLowerCase();
  return (
    <SidebarGroup
      label={
        <span data-testid={`sidebar-group-label-${slug}`} className="text-xs font-medium">
          {group.label}
        </span>
      }
    >
      {group.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basalt-ring motion-reduce:transition-none',
              isActive || isItemActive(item, pathname)
                ? 'bg-basalt-primary/10 font-medium text-basalt-primary'
                : 'text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground',
            )
          }
        >
          <item.Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        </NavLink>
      ))}
    </SidebarGroup>
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
