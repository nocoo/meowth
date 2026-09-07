import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import useAgentsViewModel from '@/viewmodels/useAgentsViewModel';
import { AlertCircle } from 'lucide-react';
import AgentsContent from './AgentsContent';
import AgentsSkeleton from './AgentsSkeleton';

// docs/architecture/06 §7.2 + features/02 §4.4 — Phase 2 Stage C2.
// Page shell: owns the viewmodel + loading/error/ready branch.
// Business render (table or real empty state) lives in
// AgentsContent; the pre-data placeholder lives in AgentsSkeleton.

export default function AgentsPage() {
  const vm = useAgentsViewModel();
  useRegisterRefresh(vm.refresh);

  return (
    <section className="space-y-6" aria-labelledby="agents-heading">
      <PageHeader
        description="Coding backends available on this machine."
        title="Agents"
        headingId="agents-heading"
      />
      {vm.status.kind === 'loading' ? (
        <AgentsSkeleton />
      ) : vm.status.kind === 'error' ? (
        <EmptyState
          icon={AlertCircle}
          title="Agents unavailable"
          description={vm.status.message}
          tone="error"
        />
      ) : (
        <AgentsContent agents={vm.status.agents} />
      )}
    </section>
  );
}
