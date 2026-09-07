import { Skeleton } from '@/components/ui/skeleton';
import { LayerCard } from '@nocoo/basalt';

const SKELETON_KEYS = ['daemon', 'tokens', 'sessions', 'agents'] as const;

export default function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading overview" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {SKELETON_KEYS.map((key) => (
          <LayerCard
            key={key}
            outlined
            className="flex min-h-36 flex-col justify-between gap-4 p-4 sm:min-h-40 sm:p-6"
            padding="lg"
          >
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-12 w-24" />
          </LayerCard>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {['activity', 'availability'].map((key) => (
          <div key={key} className="space-y-3">
            <Skeleton className="h-8 w-36" />
            <LayerCard outlined className="space-y-5" padding="lg">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </LayerCard>
          </div>
        ))}
      </div>
    </div>
  );
}
