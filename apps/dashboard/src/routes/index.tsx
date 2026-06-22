import DashboardLayout from '@/components/DashboardLayout';
import { Navigate, type RouteObject, createBrowserRouter } from 'react-router';

// docs/architecture/06 §7: the five product pages plus /setup.
// 3.14 lands placeholders only; the actual page implementations
// land in Phase 3.17 (5 pages), Phase 3.19 (/setup), and Phase
// 3.20 (live-daemon wire). Auth / bearer hydrate guards land in
// 3.18.

function Placeholder({ title }: { title: string }) {
  return (
    <section aria-labelledby={`${title}-heading`} className="space-y-2">
      <h2 id={`${title}-heading`} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="text-muted-foreground text-sm">No data yet.</p>
    </section>
  );
}

function Overview() {
  return <Placeholder title="Overview" />;
}
function Agents() {
  return <Placeholder title="Agents" />;
}
function Sessions() {
  return <Placeholder title="Sessions" />;
}
function SessionDetail() {
  return <Placeholder title="Session" />;
}
function Tokens() {
  return <Placeholder title="Tokens" />;
}
function Settings() {
  return <Placeholder title="Settings" />;
}
function Setup() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="bg-card text-card-foreground w-full max-w-md space-y-2 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Setup</h1>
        <p className="text-muted-foreground text-sm">Setup flow lands in Phase 3.19.</p>
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
      { path: 'overview', element: <Overview /> },
      { path: 'agents', element: <Agents /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'sessions/:id', element: <SessionDetail /> },
      { path: 'tokens', element: <Tokens /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  {
    path: '/setup',
    element: <Setup />,
  },
];

export const router = createBrowserRouter(routes);
