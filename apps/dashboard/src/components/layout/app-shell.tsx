import { ContentIsland, SidebarDrawer, ThemeToggle } from '@nocoo/basalt';
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from '@nocoo/basalt/components/app-header';
import {
  AppMain,
  AppSkipLink,
  AppShell as BasaltAppShell,
} from '@nocoo/basalt/components/app-shell';
import { useEffect, useId, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useIsMobile } from '@/hooks/use-mobile';
import { activeNavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { MobileNavProvider, useMobileNav } from './mobile-nav-context';
import { Sidebar } from './sidebar';

function AppShellInner() {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useMobileNav();
  const { pathname } = useLocation();
  const current = activeNavItem(pathname);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the trigger; setMobileOpen identity is stable
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile, setMobileOpen]);

  return (
    <BasaltAppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile && <Sidebar />}

      {isMobile && (
        <SidebarDrawer
          id={drawerId}
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          returnFocusRef={menuTriggerRef}
          title="Navigation"
          description="Browse Meowth pages"
        >
          <Sidebar mobile onDismiss={() => setMobileOpen(false)} />
        </SidebarDrawer>
      )}

      <AppMain>
        <AppHeader
          leading={
            isMobile ? (
              <AppHeaderMenuButton
                ref={menuTriggerRef}
                aria-controls={drawerId}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
              />
            ) : null
          }
          breadcrumbs={[{ href: '/', label: 'Meowth' }]}
          title={current?.label}
          actions={
            <>
              <ProjectLinks github="nocoo/meowth" hexly="meowth" name="Meowth" />
              <ThemeToggle />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-basalt-space-lg pb-basalt-space-lg md:px-basalt-layout-sm md:pb-basalt-layout-sm">
          <ContentIsland
            className={cn(
              'h-full w-full',
              pathname === '/chat' ? 'flex flex-col overflow-hidden p-0 md:p-0' : undefined,
            )}
          >
            <Outlet />
          </ContentIsland>
        </div>
      </AppMain>
    </BasaltAppShell>
  );
}

export function AppShell() {
  return (
    <MobileNavProvider>
      <AppShellInner />
    </MobileNavProvider>
  );
}
