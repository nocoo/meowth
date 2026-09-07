import ThemeToggle from '@/components/ThemeToggle';
import { Github } from '@/components/icons/github';
import { useIsMobile } from '@/hooks/use-mobile';
import { activeNavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@nocoo/basalt';
import { AppHeader } from '@nocoo/basalt/components/app-header';
import {
  AppMain,
  AppSkipLink,
  AppShell as BasaltAppShell,
} from '@nocoo/basalt/components/app-shell';
import { Menu } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import RefreshButton from './refresh-button';
import { RefreshProvider } from './refresh-context';
import { Sidebar } from './sidebar';
import { SidebarProvider, useSidebar } from './sidebar-context';

const GITHUB_REPO_URL = 'https://github.com/nocoo/meowth';

function AppShellInner() {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { pathname } = useLocation();
  const current = activeNavItem(pathname);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the trigger; setMobileOpen identity is stable
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <BasaltAppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile && <Sidebar />}

      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuTriggerRef.current?.focus();
            }}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Browse Meowth pages</SheetDescription>
            <Sidebar mobile />
          </SheetContent>
        </Sheet>
      )}

      <AppMain>
        <AppHeader
          leading={
            isMobile ? (
              <Button
                ref={menuTriggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
              </Button>
            ) : null
          }
          breadcrumbs={[{ href: '/', label: 'Meowth' }]}
          title={current?.label}
          actions={
            <>
              <RefreshButton />
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub repository"
                className="text-basalt-muted-foreground hover:bg-basalt-accent hover:text-basalt-foreground flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              >
                <Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
              </a>
              <ThemeToggle />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland
            className={cn(
              'rounded-basalt-island bg-basalt-card h-full w-full',
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
    <SidebarProvider>
      <RefreshProvider>
        <AppShellInner />
      </RefreshProvider>
    </SidebarProvider>
  );
}
