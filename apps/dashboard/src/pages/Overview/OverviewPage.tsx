import useOverviewViewModel from '@/viewmodels/useOverviewViewModel';

// docs/architecture/06 §7.1 — Overview page.

function Card({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="bg-card text-card-foreground rounded-lg border p-4">
      <h3 className="text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
      <div className="mt-2 text-2xl font-semibold">{body}</div>
    </div>
  );
}

export default function OverviewPage() {
  const vm = useOverviewViewModel();

  if (vm.status.kind === 'loading') {
    return (
      <section aria-labelledby="overview-heading" className="space-y-2">
        <h2 id="overview-heading" className="text-xl font-semibold">
          Overview
        </h2>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </section>
    );
  }
  if (vm.status.kind === 'error') {
    return (
      <section aria-labelledby="overview-heading" className="space-y-2">
        <h2 id="overview-heading" className="text-xl font-semibold">
          Overview
        </h2>
        <p role="alert" className="text-destructive text-sm">
          {vm.status.message}
        </p>
      </section>
    );
  }

  const { health, tokens, sessions, agents } = vm.status.data;
  const installed = agents.filter((a) => a.installed).length;
  return (
    <section aria-labelledby="overview-heading" className="space-y-4">
      <h2 id="overview-heading" className="text-xl font-semibold">
        Overview
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Daemon" body={health?.ok === true ? 'Reachable' : 'Unknown'} />
        <Card title="Tokens" body={tokens.length} />
        <Card title="Recent sessions" body={sessions.length} />
        <Card title="Agents installed" body={`${installed} / ${agents.length}`} />
      </div>
    </section>
  );
}
