import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3a.
// Mirrors SessionsListContent's 5-column table layout so the
// pre-data layout reserves the same footprint. 5 placeholder rows
// matches the typical "a few recent sessions" surface.
//
// Bug fix Commit 2 — wraps the same `rounded-card bg-secondary
// overflow-hidden` L2 surface so the placeholder matches the
// resolved table tier.

const SKELETON_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
const SKELETON_COLS = ['backend', 'status', 'model', 'started', 'thread'] as const;

export default function SessionsListSkeleton() {
  return (
    <div className="rounded-card bg-secondary overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Backend</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Thread</TableHead>
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
