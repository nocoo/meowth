import useAgentsViewModel from '@/viewmodels/useAgentsViewModel';

// docs/architecture/06 §7.2 — Agents page.

export default function AgentsPage() {
  const vm = useAgentsViewModel();

  if (vm.status.kind === 'loading') {
    return (
      <section aria-labelledby="agents-heading" className="space-y-2">
        <h2 id="agents-heading" className="text-xl font-semibold">
          Agents
        </h2>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </section>
    );
  }
  if (vm.status.kind === 'error') {
    return (
      <section aria-labelledby="agents-heading" className="space-y-2">
        <h2 id="agents-heading" className="text-xl font-semibold">
          Agents
        </h2>
        <p role="alert" className="text-destructive text-sm">
          {vm.status.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="agents-heading" className="space-y-2">
      <h2 id="agents-heading" className="text-xl font-semibold">
        Agents
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Installed</th>
            <th className="py-1 pr-2">Executable</th>
            <th className="py-1 pr-2">Version</th>
          </tr>
        </thead>
        <tbody>
          {vm.status.agents.map((agent) => (
            <tr key={agent.type} className="border-border border-t">
              <td className="py-2 pr-2 font-mono">{agent.type}</td>
              <td className="py-2 pr-2">{agent.installed ? 'yes' : 'no'}</td>
              <td className="py-2 pr-2 font-mono text-xs">{agent.executable}</td>
              <td className="py-2 pr-2 font-mono text-xs">{agent.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
