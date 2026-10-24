import {
  Avatar,
  AvatarFallback,
  Sidebar as BasaltSidebar,
  Button,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@nocoo/basalt';
import { PanelLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import BrandMark from '@/components/BrandMark';
import { isItemActive, NAV_GROUPS, NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
import { useSidebar } from './sidebar-context';

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isCollapsed = mobile ? false : collapsed;

  return (
    <TooltipProvider delayDuration={0}>
      <BasaltSidebar
        collapsed={isCollapsed}
        aria-label="Primary navigation"
        className={cn('motion-reduce:transition-none', mobile && 'h-full')}
      >
        {isCollapsed ? (
          <CollapsedView pathname={pathname} toggle={toggle} navigate={navigate} />
        ) : (
          <ExpandedView pathname={pathname} toggle={toggle} mobile={mobile} navigate={navigate} />
        )}
      </BasaltSidebar>
    </TooltipProvider>
  );
}

type Navigate = ReturnType<typeof useNavigate>;

function CollapsedView({
  pathname,
  toggle,
  navigate,
}: {
  pathname: string;
  toggle: () => void;
  navigate: Navigate;
}) {
  return (
    <>
      <SidebarHeader>
        <BrandMark alt="Meowth" />
      </SidebarHeader>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mb-basalt-space-sm self-center"
        onClick={toggle}
        aria-label="Expand sidebar"
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      </Button>

      <SidebarNav aria-label="Pages">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.to} delayDuration={0}>
            <TooltipTrigger asChild>
              <SidebarIconItem
                aria-label={item.label}
                active={isItemActive(item, pathname)}
                onClick={() => navigate(item.to)}
              >
                <item.Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
              </SidebarIconItem>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </SidebarNav>

      <SidebarFooter>
        <Avatar className="h-9 w-9 self-center">
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
  navigate,
}: {
  pathname: string;
  toggle: () => void;
  mobile: boolean;
  navigate: Navigate;
}) {
  return (
    <>
      <SidebarHeader>
        <div className="flex w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-basalt-space-lg">
            <BrandMark alt="Meowth" />
            <span className="truncate text-lg font-semibold text-basalt-foreground md:text-xl">
              Meowth
            </span>
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

      <SidebarNav aria-label="Pages">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup
            key={group.label}
            label={
              <span data-testid={`sidebar-group-label-${group.label.toLowerCase()}`}>
                {group.label}
              </span>
            }
          >
            {group.items.map((item) => (
              <SidebarItem
                key={item.to}
                active={isItemActive(item, pathname)}
                onClick={() => navigate(item.to)}
              >
                <item.Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
              </SidebarItem>
            ))}
          </SidebarGroup>
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

function VersionPill() {
  return (
    <span
      data-testid="sidebar-version-pill"
      className="shrink-0 rounded-md bg-basalt-secondary text-basalt-muted-foreground px-basalt-space-md py-basalt-space-xs font-mono text-[10px] leading-none font-medium"
    >
      v{APP_VERSION}
    </span>
  );
}
