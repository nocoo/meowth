import { Skeleton } from '@/components/ui/skeleton';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3a.
// Mirrors SessionsListContent's 5-column table layout so the
// pre-data layout reserves the same footprint. 5 placeholder rows
// matches the typical "a few recent sessions" surface.

const SKELETON_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const SKELETON_COLS = ['backend', 'status', 'model', 'started', 'thread'] as const;

export default function SessionsListSkeleton() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-2">Backend</th>
          <th className="py-1 pr-2">Status</th>
          <th className="py-1 pr-2">Model</th>
          <th className="py-1 pr-2">Started</th>
          <th className="py-1 pr-2">Thread</th>
        </tr>
      </thead>
      <tbody>
        {SKELETON_ROWS.map((row) => (
          <tr key={row} className="border-border border-t">
            {SKELETON_COLS.map((col) => (
              <td key={col} className="py-2 pr-2">
                <Skeleton className="h-4 w-24" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
