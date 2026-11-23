import { LayerCard } from '@nocoo/basalt';
import { Skeleton } from '@nocoo/basalt/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nocoo/basalt/components/table';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Pre-data placeholder for TokensContent. Mirrors the 5-column
// table layout (Name / Prefix / Created / Last used / Revoke).
//
// Bug fix Commit 2 — wraps the same `rounded-basalt-card bg-basalt-secondary
// overflow-hidden` L2 surface so the placeholder and the resolved
// table sit on the same surface tier.

const SKELETON_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const SKELETON_COLS = ['name', 'prefix', 'created', 'last_used', 'action'] as const;

export default function TokensSkeleton() {
  return (
    <LayerCard padding="none" outlined className="overflow-x-auto">
      <div data-slot="table-container" className="relative w-full overflow-x-auto">
        <Table className="whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {SKELETON_ROWS.map((row) => (
              <TableRow key={row}>
                {SKELETON_COLS.map((col) => (
                  <TableCell key={col}>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </LayerCard>
  );
}
