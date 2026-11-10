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

function SidebarUserAvatar() {
  return (
    <Avatar>
      <AvatarFallback>M</AvatarFallback>
    </Avatar>
  );
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
        <SidebarHeader>
          {isCollapsed ? (
            <BrandMark alt="Meowth" />
          ) : (
            <div className="flex w-full items-center justify-between">
              <div className="flex min-w-0 items-center gap-basalt-space-lg">
                <BrandMark alt="Meowth" />
                <span className="truncate text-lg font-semibold text-basalt-foreground md:text-xl">
                  Meowth
                </span>
                <span
                  data-testid="sidebar-version-pill"
                  className="shrink-0 rounded-md bg-basalt-secondary px-basalt-space-md py-basalt-space-xs text-basalt-xs leading-none font-medium text-basalt-muted-foreground"
                >
                  v{APP_VERSION}
                </span>
              </div>
              {mobile ? null : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={toggle}
                      aria-label="Collapse sidebar"
                    >
                      <PanelLeft aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </SidebarHeader>

        {isCollapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Expand sidebar"
              >
                <PanelLeft aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Expand sidebar
            </TooltipContent>
          </Tooltip>
        ) : null}

        <SidebarNav aria-label="Pages">
          {isCollapsed
            ? NAV_ITEMS.map((item) => (
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
              ))
            : NAV_GROUPS.map((group) => (
                <SidebarGroup key={group.label} label={group.label}>
                  {group.items.map((item) => (
                    <SidebarItem
                      key={item.to}
                      active={isItemActive(item, pathname)}
                      onClick={() => navigate(item.to)}
                    >
                      <item.Icon
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                        strokeWidth={1.5}
                      />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                    </SidebarItem>
                  ))}
                </SidebarGroup>
              ))}
        </SidebarNav>

        <SidebarFooter>
          <SidebarUser
            name="Meowth"
            email={isCollapsed ? undefined : 'Local daemon'}
            avatar={<SidebarUserAvatar />}
          />
        </SidebarFooter>
      </BasaltSidebar>
    </TooltipProvider>
  );
}
