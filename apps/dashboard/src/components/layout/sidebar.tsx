import {
  Avatar,
  AvatarFallback,
  Sidebar as BasaltSidebar,
  SidebarBrand,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarToggle,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@nocoo/basalt';
import { useSidebar as useBasaltSidebar } from '@nocoo/basalt/components/sidebar';
import { useLocation, useNavigate } from 'react-router';
import BrandMark from '@/components/BrandMark';
import { isItemActive, NAV_GROUPS, NAV_ITEMS } from '@/lib/navigation';
import { APP_VERSION } from '@/lib/version';

export interface SidebarProps {
  mobile?: boolean;
  onDismiss?: () => void;
}

function SidebarUserAvatar() {
  return (
    <Avatar>
      <AvatarFallback>M</AvatarFallback>
    </Avatar>
  );
}

function SidebarBody({ mobile, onDismiss }: { mobile: boolean; onDismiss?: () => void }) {
  const { collapsed } = useBasaltSidebar();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <SidebarHeader>
        <SidebarBrand
          logo={<BrandMark size={24} alt="Meowth" />}
          name="Meowth"
          version={`v${APP_VERSION}`}
          action={
            mobile ? (
              <SidebarToggle
                mode="dismiss"
                dismissLabel="Close navigation"
                {...(onDismiss ? { onDismiss } : {})}
              />
            ) : (
              <SidebarToggle />
            )
          }
        />
      </SidebarHeader>

      <SidebarNav aria-label="Pages">
        {collapsed
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
                    <item.Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
                    <span className="flex-1 truncate text-left">{item.label}</span>
                  </SidebarItem>
                ))}
              </SidebarGroup>
            ))}
      </SidebarNav>

      <SidebarFooter>
        <SidebarUser
          name="Meowth"
          email="Local daemon"
          avatar={<SidebarUserAvatar />}
          tooltip="Meowth"
        />
      </SidebarFooter>
    </>
  );
}

export function Sidebar({ mobile = false, onDismiss }: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <BasaltSidebar aria-label="Primary navigation" resizable={false}>
        <SidebarBody mobile={mobile} {...(onDismiss ? { onDismiss } : {})} />
      </BasaltSidebar>
    </TooltipProvider>
  );
}
