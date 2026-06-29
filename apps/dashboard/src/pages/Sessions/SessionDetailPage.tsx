import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { EmptyState } from '@/components/ui/empty-state';
import useSessionDetailViewModel from '@/viewmodels/useSessionDetailViewModel';
import { AlertCircle } from 'lucide-react';
import { useParams } from 'react-router';
import SessionDetailContent from './SessionDetailContent';
import SessionDetailSkeleton from './SessionDetailSkeleton';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3b.
// Page shell: route-param + viewmodel + branch only. Business
// rendering lives in SessionDetailContent; pre-data placeholder
// in SessionDetailSkeleton. Per reviewer guidance the error
// branch keeps Heading + `data-testid="session-detail-id"` row
// + an EmptyState so existing detail-error semantics survive.

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const vm = useSessionDetailViewModel(sessionId);
  useRegisterRefresh(vm.refresh);

  return (
    <section aria-labelledby="session-detail-heading" className="space-y-3">
      <h2 id="session-detail-heading" className="text-xl font-semibold">
        Session
      </h2>
      {vm.status.kind === 'loading' ? (
        <SessionDetailSkeleton />
      ) : vm.status.kind === 'error' ? (
        <>
          <p className="text-muted-foreground font-mono text-xs" data-testid="session-detail-id">
            {vm.sessionId}
          </p>
          <EmptyState
            icon={AlertCircle}
            title="Session unavailable"
            description={vm.status.message}
            tone="error"
          />
        </>
      ) : (
        <SessionDetailContent session={vm.status.session} messages={vm.status.messages} />
      )}
    </section>
  );
}
