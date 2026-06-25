import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Pre-data placeholder for TokensContent. Mirrors the 5-column
// table layout (Name / Prefix / Created / Last used / Revoke).
//
// Bug fix Commit 2 — wraps the same `rounded-card bg-secondary
// overflow-hidden` L2 surface so the placeholder and the resolved
// table sit on the same surface tier.

const SKELETON_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const SKELETON_COLS = ['name', 'prefix', 'created', 'last_used', 'action'] as const;

export default function TokensSkeleton() {
  return (
    <div className="rounded-card bg-secondary overflow-hidden">
      <Table>
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
  );
}
