import DashboardLayout from '@/components/DashboardLayout';
import AgentsPage from '@/pages/Agents';
import OverviewPage from '@/pages/Overview';
import SessionsListPage, { SessionDetailPage } from '@/pages/Sessions';
import SettingsPage from '@/pages/Settings';
import TokensPage from '@/pages/Tokens';
import { Navigate, type RouteObject, createBrowserRouter } from 'react-router';

// docs/architecture/06 §7: the five product pages plus /setup.
// 3.17 wires the page components; /setup remains an inline
// placeholder until 3.19 lands the real flow. Routing guards
// (bearer / setup hydration) land in 3.18.

function Setup() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="bg-card text-card-foreground w-full max-w-md space-y-2 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Setup</h1>
        <p className="text-muted-foreground text-sm">Setup is not configured yet.</p>
      </div>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'sessions', element: <SessionsListPage /> },
      { path: 'sessions/:id', element: <SessionDetailPage /> },
      { path: 'tokens', element: <TokensPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '/setup',
    element: <Setup />,
  },
];

export const router = createBrowserRouter(routes);
