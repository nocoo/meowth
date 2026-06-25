import { Skeleton } from '@/components/ui/skeleton';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Pre-data placeholder for TokensContent. Mirrors the 5-column
// table layout (Name / Prefix / Created / Last used / Revoke).

const SKELETON_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const SKELETON_COLS = ['name', 'prefix', 'created', 'last_used', 'action'] as const;

export default function TokensSkeleton() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-2">Name</th>
          <th className="py-1 pr-2">Prefix</th>
          <th className="py-1 pr-2">Created</th>
          <th className="py-1 pr-2">Last used</th>
          <th className="py-1 pr-2" />
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
