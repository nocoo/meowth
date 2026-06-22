import AuthGate from '@/components/AuthGate';
import DashboardLayout from '@/components/DashboardLayout';
import AgentsPage from '@/pages/Agents';
import OverviewPage from '@/pages/Overview';
import SessionsListPage, { SessionDetailPage } from '@/pages/Sessions';
import SettingsPage from '@/pages/Settings';
import SetupPage from '@/pages/Setup';
import TokensPage from '@/pages/Tokens';
import { Navigate, type RouteObject, createBrowserRouter } from 'react-router';

// docs/architecture/06 §7 + §10 — the five product pages live
// behind <AuthGate>, which probes /v1/agents on mount and
// redirects to /setup on missing/invalid token. /setup is
// outside the gate so the gate never needs to short-circuit on
// pathname (no conditional hooks).

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <AuthGate>
        <DashboardLayout />
      </AuthGate>
    ),
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
