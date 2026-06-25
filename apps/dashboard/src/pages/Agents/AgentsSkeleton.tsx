import { Skeleton } from '@/components/ui/skeleton';

// docs/architecture/06 §7.2 + features/02 §4.4 — Phase 2 Stage C2.
// Mirror AgentsContent's table layout (4 columns × ~5 rows) so the
// pre-data layout reserves the same footprint. The 5-row estimate
// matches the production backend count (claude / copilot / codex /
// hermes / pi) — close enough that the swap to real content does
// not visibly reflow.

const SKELETON_ROWS = ['claude', 'copilot', 'codex', 'hermes', 'pi'] as const;
const SKELETON_COLS = ['type', 'installed', 'executable', 'version'] as const;

export default function AgentsSkeleton() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-2">Type</th>
          <th className="py-1 pr-2">Installed</th>
          <th className="py-1 pr-2">Executable</th>
          <th className="py-1 pr-2">Version</th>
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
