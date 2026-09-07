import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import useOverviewViewModel from '@/viewmodels/useOverviewViewModel';
import { AlertCircle } from 'lucide-react';
import OverviewContent from './OverviewContent';
import OverviewSkeleton from './OverviewSkeleton';

// docs/architecture/06 §7.1 + features/02 §4.4 — Phase 2 Stage C1.
// Page shell: owns the viewmodel and the loading/error/ready
// branch only. Business render lives in `OverviewContent`; the
// pre-data layout placeholder lives in `OverviewSkeleton`.

export default function OverviewPage() {
  const vm = useOverviewViewModel();
  useRegisterRefresh(vm.refresh);

  return (
    <section className="space-y-6" aria-labelledby="overview-heading">
      <PageHeader
        description="A snapshot of your local coding agents and activity."
        title="Overview"
        headingId="overview-heading"
      />
      {vm.status.kind === 'loading' ? (
        <OverviewSkeleton />
      ) : vm.status.kind === 'error' ? (
        <EmptyState
          icon={AlertCircle}
          title="Overview unavailable"
          description={vm.status.message}
          tone="error"
        />
      ) : (
        <OverviewContent data={vm.status.data} />
      )}
    </section>
  );
}
