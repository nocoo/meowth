import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import useSessionsViewModel from '@/viewmodels/useSessionsViewModel';
import { AlertCircle } from 'lucide-react';
import SessionsListContent from './SessionsListContent';
import SessionsListSkeleton from './SessionsListSkeleton';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3a.
// Page shell: owns the viewmodel + loading/error/ready branch.
// Business render (table or true-empty EmptyState) lives in
// SessionsListContent; the pre-data placeholder lives in
// SessionsListSkeleton.

export default function SessionsListPage() {
  const vm = useSessionsViewModel();

  return (
    <section className="space-y-6" aria-labelledby="sessions-heading">
      <PageHeader
        description="Browse recent runs and inspect their output."
        title="Sessions"
        headingId="sessions-heading"
      />
      {vm.status.kind === 'loading' ? (
        <SessionsListSkeleton />
      ) : vm.status.kind === 'error' ? (
        <EmptyState
          icon={AlertCircle}
          title="Sessions unavailable"
          description={vm.status.message}
          tone="error"
          action={
            <Button variant="outline" size="xs" onClick={vm.refresh}>
              Retry
            </Button>
          }
        />
      ) : (
        <SessionsListContent sessions={vm.status.sessions} />
      )}
    </section>
  );
}
