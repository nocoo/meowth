import DashboardLayout from '@/components/DashboardLayout';
import AgentsPage from '@/pages/Agents';
import OverviewPage from '@/pages/Overview';
import SessionsListPage, { SessionDetailPage } from '@/pages/Sessions';
import SettingsPage from '@/pages/Settings';
import SetupPage from '@/pages/Setup';
import TokensPage from '@/pages/Tokens';
import { Navigate, type RouteObject, createBrowserRouter } from 'react-router';

// docs/architecture/06 §7: the five product pages plus /setup.
// 3.17 wired the product pages; 3.19 lands the real /setup page.
// Routing guards (bearer hydrate + 401 redirect) land in 3.20.

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
    element: <SetupPage />,
  },
];

export const router = createBrowserRouter(routes);
