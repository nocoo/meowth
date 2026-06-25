import { Skeleton } from '@/components/ui/skeleton';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3b.
// Pre-data placeholder for SessionDetail. Mirrors the visible
// footprint of SessionDetailContent: id row, meta row, then
// three envelope-sized rows. No table/card wrappers — the real
// content is a stack of bordered divs, not a table.

const MESSAGE_ROW_KEYS = ['m1', 'm2', 'm3'] as const;

export default function SessionDetailSkeleton() {
  return (
    <>
      <div className="space-y-1 text-sm">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-52" />
      </div>
      <div>
        {MESSAGE_ROW_KEYS.map((row) => (
          <div key={row} className="border-border space-y-2 border-t py-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}
