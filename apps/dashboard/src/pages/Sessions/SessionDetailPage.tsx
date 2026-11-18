import { Button } from '@nocoo/basalt/components/button';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { AlertCircle } from '@nocoo/basalt/icons';
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import useSessionDetailViewModel from '@/viewmodels/useSessionDetailViewModel';
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
        title={<span id="session-detail-heading">Session</span>}
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
              <Button variant="outline" size="sm" onClick={vm.refresh}>
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
