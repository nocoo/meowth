import ThemeToggle from '@/components/ThemeToggle';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { activeNavItem } from '@/lib/navigation';
import { Menu } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Breadcrumbs } from './breadcrumbs';
import { Sidebar } from './sidebar';
import { SidebarProvider, useSidebar } from './sidebar-context';

// Meowth-local Gen 2 AppShell. Inspired by surety's
// components/layout/app-shell.tsx (commit cbf7045f) but adapted for
// meowth: no CommandPalette, no GitHub link, no DbSelector. The
// host product is a single-user local daemon dashboard, so the
// header right side is just ThemeToggle.
//
// Layout contract:
//
//   <SidebarProvider>
//     <div bg-background flex>
//       Sidebar (sticky, L0)
//       <main>
//         <header h-14 no-border>  Breadcrumbs              ThemeToggle
//         <div padding>
//           <div rounded-island bg-card>          (L1 floating island)
//             <Outlet />
//           </div>
//         </div>
//       </main>
//     </div>
//   </SidebarProvider>
//
// Mobile drawer Sheet a11y behaviors required by the redesign plan
// §7.3 are enforced in `AppShellInner`:
//   - route change closes drawer (useLocation effect)
//   - body scroll unlock on close (overflow effect cleanup)
//   - aria title/description on SheetHeader (sr-only)
//   - escape/overlay close routed through Radix Dialog (Sheet uses
//     `onOpenChange` to keep the provider in sync)
//   - focus return is driven by hand: the menu trigger lives
//     outside the Sheet subtree, so Radix's default trigger-return
//     cannot find it; we hold a ref to the trigger and call
//     `event.preventDefault()` + `menuTriggerRef.current?.focus()`
//     from `<SheetContent onCloseAutoFocus>`.

function AppShellInner() {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { pathname } = useLocation();
  const current = activeNavItem(pathname);
  const breadcrumbs = current ? [{ label: current.label }] : [];
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the trigger; setMobileOpen identity is stable
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="bg-background flex min-h-screen w-full">
      {!isMobile && <Sidebar />}

      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[260px] p-0 sm:max-w-[260px]"
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              // Radix Dialog's default `onCloseAutoFocus` returns
              // focus to the Trigger; we mount the trigger button
              // outside the Sheet (it has to be visible in the
              // header to be tappable on mobile) so Radix has no
              // trigger to focus. Drive the contract by hand: stop
              // Radix's auto-focus, then focus our remembered
              // toggle ref.
              event.preventDefault();
              menuTriggerRef.current?.focus();
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Browse Meowth pages</SheetDescription>
            </SheetHeader>
            <Sidebar mobile />
          </SheetContent>
        </Sheet>
      )}

      <main className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              >
                <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
              </button>
            )}
            <Breadcrumbs items={[{ label: 'Meowth', href: '/' }, ...breadcrumbs]} />
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
          <div className="rounded-island bg-card h-full overflow-y-auto p-3 md:p-5">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

export function AppShell() {
  return (
    <SidebarProvider>
      <AppShellInner />
    </SidebarProvider>
  );
}
