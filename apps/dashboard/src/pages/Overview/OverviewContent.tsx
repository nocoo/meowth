import StatCard from '@/components/StatCard';
import type { OverviewData } from '@/viewmodels/useOverviewViewModel';

// docs/architecture/06 §7.1 + features/02 §4.4 — Phase 2 Stage C1.
// Pure-props Content component: receives the already-resolved
// OverviewData and emits the four stat tiles. Owns no state, no
// fetch, no effect. Tested in isolation with mock data so the
// loading/error/ready transitions stay the page shell's concern.

export interface OverviewContentProps {
  data: OverviewData;
}

export default function OverviewContent({ data }: OverviewContentProps) {
  const { health, tokens, sessions, agents } = data;
  const installed = agents.filter((a) => a.installed).length;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard title="Daemon" body={health?.ok === true ? 'Reachable' : 'Unknown'} />
      <StatCard title="Tokens" body={tokens.length} />
      <StatCard title="Recent sessions" body={sessions.length} />
      <StatCard title="Agents installed" body={`${installed} / ${agents.length}`} />
    </div>
  );
}
