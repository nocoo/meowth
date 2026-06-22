import useSessionsViewModel from '@/viewmodels/useSessionsViewModel';
import { Link } from 'react-router';

// docs/architecture/06 §7.3 — Sessions list page.

export default function SessionsListPage() {
  const vm = useSessionsViewModel();

  if (vm.status.kind === 'loading') {
    return (
      <section aria-labelledby="sessions-heading" className="space-y-2">
        <h2 id="sessions-heading" className="text-xl font-semibold">
          Sessions
        </h2>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </section>
    );
  }
  if (vm.status.kind === 'error') {
    return (
      <section aria-labelledby="sessions-heading" className="space-y-2">
        <h2 id="sessions-heading" className="text-xl font-semibold">
          Sessions
        </h2>
        <p role="alert" className="text-destructive text-sm">
          {vm.status.message}
        </p>
      </section>
    );
  }
  if (vm.status.sessions.length === 0) {
    return (
      <section aria-labelledby="sessions-heading" className="space-y-2">
        <h2 id="sessions-heading" className="text-xl font-semibold">
          Sessions
        </h2>
        <p className="text-muted-foreground text-sm">No sessions yet.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sessions-heading" className="space-y-2">
      <h2 id="sessions-heading" className="text-xl font-semibold">
        Sessions
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 pr-2">Backend</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1 pr-2">Model</th>
            <th className="py-1 pr-2">Started</th>
            <th className="py-1 pr-2">Thread</th>
          </tr>
        </thead>
        <tbody>
          {vm.status.sessions.map((session) => (
            <tr key={session.id} className="border-border border-t">
              <td className="py-2 pr-2 font-mono">
                <Link to={`/sessions/${session.id}`} className="text-primary hover:underline">
                  {session.backend_type}
                </Link>
              </td>
              <td className="py-2 pr-2">{session.status}</td>
              <td className="py-2 pr-2 font-mono text-xs">{session.model}</td>
              <td className="py-2 pr-2 font-mono text-xs">{session.started_at}</td>
              <td className="py-2 pr-2 text-xs">{session.thread_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
