import { EmptyState } from '@/components/ui/empty-state';
import type { Agent } from '@/models/types';
import { Bot } from 'lucide-react';

// docs/architecture/06 §7.2 + features/02 §4.4 — Phase 2 Stage C2.
// Pure-props Content component. Receives the resolved agents list
// and renders the same table semantics the page had before (table
// + cell roles, no fake stat cards). EmptyState appears only when
// the daemon legitimately returns zero agents.

export interface AgentsContentProps {
  agents: readonly Agent[];
}

export default function AgentsContent({ agents }: AgentsContentProps) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents installed"
        description="meowthd reports zero local backends; install at least one (claude / copilot / codex / hermes / pi) to run sessions."
      />
    );
  }
  return (
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
        {agents.map((agent) => (
          <tr key={agent.type} className="border-border border-t">
            <td className="py-2 pr-2 font-mono">{agent.type}</td>
            <td className="py-2 pr-2">{agent.installed ? 'yes' : 'no'}</td>
            <td className="py-2 pr-2 font-mono text-xs">{agent.executable}</td>
            <td className="py-2 pr-2 font-mono text-xs">{agent.version}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
