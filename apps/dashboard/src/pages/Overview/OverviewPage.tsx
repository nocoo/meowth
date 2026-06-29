import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { EmptyState } from '@/components/ui/empty-state';
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
    <section aria-labelledby="overview-heading" className="space-y-4">
      <h2 id="overview-heading" className="text-xl font-semibold">
        Overview
      </h2>
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
