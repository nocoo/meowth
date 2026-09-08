import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import useSessionDetailViewModel from '@/viewmodels/useSessionDetailViewModel';
import { AlertCircle } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { useParams } from 'react-router';
import SessionDetailSkeleton from './SessionDetailSkeleton';

const SessionDetailContent = lazy(() => import('./SessionDetailContent'));

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

  return (
    <section className="space-y-6" aria-labelledby="session-detail-heading">
      <PageHeader
        description="Conversation and run details."
        title="Session"
        headingId="session-detail-heading"
      />
      {vm.status.kind === 'loading' ? (
        <SessionDetailSkeleton />
      ) : vm.status.kind === 'error' ? (
        <>
          <p
            className="text-basalt-muted-foreground font-mono text-xs"
            data-testid="session-detail-id"
          >
            {vm.sessionId}
          </p>
          <EmptyState
            icon={AlertCircle}
            title="Session unavailable"
            description={vm.status.message}
            tone="error"
            action={
              <Button variant="outline" size="xs" onClick={vm.refresh}>
                Retry
              </Button>
            }
          />
        </>
      ) : (
        <Suspense fallback={<SessionDetailSkeleton />}>
          <SessionDetailContent session={vm.status.session} messages={vm.status.messages} />
        </Suspense>
      )}
    </section>
  );
}
