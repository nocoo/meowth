import AppSidebar from '@/components/AppSidebar';
import ThemeToggle from '@/components/ThemeToggle';
import { Outlet } from 'react-router';

// docs/architecture/06 §4.1.2: meowth-local DashboardLayout (not
// a verbatim basalt copy). Header carries the plain text "Meowth"
// brand (no logo per 01 §6) and the ThemeToggle. The sidebar +
// main split is the only top-level layout v1 needs.
export default function DashboardLayout() {
  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <h1 className="text-base font-semibold">Meowth</h1>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
