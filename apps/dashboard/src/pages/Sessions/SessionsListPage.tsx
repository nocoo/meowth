import useSessionsViewModel from '@/viewmodels/useSessionsViewModel';

// docs/architecture/06 §7.3 — Sessions list page.
// Skeleton renders empty state; 3.18+ wires sessions.listSessions().

export default function SessionsListPage() {
  const vm = useSessionsViewModel();
  return (
    <section aria-labelledby="sessions-heading" className="space-y-2">
      <h2 id="sessions-heading" className="text-xl font-semibold">
        Sessions
      </h2>
      <p className="text-muted-foreground text-sm">
        {vm.sessions.length === 0 ? 'No data yet.' : 'Loading…'}
      </p>
    </section>
  );
}
