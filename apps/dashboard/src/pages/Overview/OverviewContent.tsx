import StatCard from '@/components/StatCard';
import { Badge } from '@/components/ui/badge';
import type { OverviewData } from '@/viewmodels/useOverviewViewModel';
import { Activity, Bot, KeyRound, ListTree } from 'lucide-react';

export interface OverviewContentProps {
  data: OverviewData;
}

export default function OverviewContent({ data }: OverviewContentProps) {
  const { health, tokens, sessions, agents } = data;
  const installed = agents.filter((a) => a.installed).length;
  const reachable = health?.ok === true;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Daemon"
        icon={Activity}
        body={
          <Badge variant={reachable ? 'success' : 'warning'}>
            {reachable ? 'Reachable' : 'Unknown'}
          </Badge>
        }
      />
      <StatCard title="Tokens" icon={KeyRound} body={tokens.length} />
      <StatCard title="Recent sessions" icon={ListTree} body={sessions.length} />
      <StatCard title="Agents installed" icon={Bot} body={`${installed} / ${agents.length}`} />
    </div>
  );
}
