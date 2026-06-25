import { Skeleton } from '@/components/ui/skeleton';

// docs/architecture/06 §7.1 + features/02 §4.4 — Phase 2 Stage C1.
// Per-page Skeleton mirroring `OverviewContent`'s 4-tile grid so the
// pre-data layout reserves the same footprint.

const SKELETON_KEYS = ['daemon', 'tokens', 'sessions', 'agents'] as const;

export default function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="bg-secondary rounded-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
