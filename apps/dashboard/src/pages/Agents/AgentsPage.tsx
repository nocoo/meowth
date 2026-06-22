import useAgentsViewModel from '@/viewmodels/useAgentsViewModel';

// docs/architecture/06 §7.2 — Agents page.
// Skeleton renders an empty list; 3.18+ wires agents.fetchAgents().

export default function AgentsPage() {
  const vm = useAgentsViewModel();
  return (
    <section aria-labelledby="agents-heading" className="space-y-2">
      <h2 id="agents-heading" className="text-xl font-semibold">
        Agents
      </h2>
      <p className="text-muted-foreground text-sm">
        {vm.agents.length === 0 ? 'No data yet.' : 'Loading…'}
      </p>
    </section>
  );
}
