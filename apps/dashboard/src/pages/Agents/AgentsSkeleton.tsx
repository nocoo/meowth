import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// docs/architecture/06 §7.2 + features/02 §4.4 — Phase 2 Stage C2.
// Mirror AgentsContent's table layout (4 columns × ~5 rows) so the
// pre-data layout reserves the same footprint. The 5-row estimate
// matches the production backend count (claude / copilot / codex /
// hermes / pi) — close enough that the swap to real content does
// not visibly reflow.
//
// Bug fix Commit 2 — wraps the same `rounded-card bg-secondary
// overflow-hidden` L2 surface so the placeholder and the resolved
// table sit on the same surface tier.

const SKELETON_ROWS = ['claude', 'copilot', 'codex', 'hermes', 'pi'] as const;
const SKELETON_COLS = ['type', 'installed', 'executable', 'version'] as const;

export default function AgentsSkeleton() {
  return (
    <div className="rounded-card bg-secondary overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Installed</TableHead>
            <TableHead>Executable</TableHead>
            <TableHead>Version</TableHead>
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
