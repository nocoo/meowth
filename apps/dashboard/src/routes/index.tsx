import AuthGate from '@/components/AuthGate';
import { BasaltRouteProviders } from '@/components/basalt-providers';
import { AppShell } from '@/components/layout';
import AgentsPage from '@/pages/Agents';
import ChatSkeleton from '@/pages/Chat/ChatSkeleton';
import OverviewPage from '@/pages/Overview';
import SessionsListPage, { SessionDetailPage } from '@/pages/Sessions';
import SettingsPage from '@/pages/Settings';
import SetupPage from '@/pages/Setup';
import TokensPage from '@/pages/Tokens';
import { Suspense, lazy } from 'react';
import { Navigate, Outlet, type RouteObject, createBrowserRouter } from 'react-router';

const ChatPage = lazy(() => import('@/pages/Chat'));

function RootLayout() {
  return (
    <BasaltRouteProviders>
      <Outlet />
    </BasaltRouteProviders>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: (
          <AuthGate>
            <AppShell />
          </AuthGate>
        ),
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: 'overview', element: <OverviewPage /> },
          { path: 'agents', element: <AgentsPage /> },
          {
            path: 'chat',
            element: (
              <Suspense fallback={<ChatSkeleton />}>
                <ChatPage />
              </Suspense>
            ),
          },
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
    ],
  },
];

export const router = createBrowserRouter(routes);
