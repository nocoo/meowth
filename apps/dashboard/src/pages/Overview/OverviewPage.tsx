import useOverviewViewModel from '@/viewmodels/useOverviewViewModel';

// docs/architecture/06 §7.1 — Overview page.
// Skeleton render only; 3.18+ wires health/tokens/sessions/agents.

export default function OverviewPage() {
  const vm = useOverviewViewModel();
  const isEmpty = vm.tokens.length === 0 && vm.sessions.length === 0 && vm.agents.length === 0;
  return (
    <section aria-labelledby="overview-heading" className="space-y-2">
      <h2 id="overview-heading" className="text-xl font-semibold">
        Overview
      </h2>
      <p className="text-muted-foreground text-sm">{isEmpty ? 'No data yet.' : 'Loading…'}</p>
    </section>
  );
}
