import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { displayLabel } from '@/lib/labels';
import type { Agent } from '@/viewmodels/useAgentsViewModel';
import { Bot } from 'lucide-react';

// docs/architecture/06 §7.2 + features/02 §4.4 — Phase 2 Stage C2.
// Pure-props Content component. Receives the resolved agents list
// and renders the same table semantics the page had before (table
// + cell roles, no fake stat cards). EmptyState appears only when
// the daemon legitimately returns zero agents.
//
// Bug fix Commit 2 — wraps the data table in a
// `rounded-basalt-card bg-basalt-secondary overflow-hidden` L2 surface so the
// table visually sits on the white/secondary tier, matching the
// surface ladder enforced by 06 §5.1. The cell semantics (role,
// content) are unchanged.

export interface AgentsContentProps {
  agents: readonly Agent[];
}

export default function AgentsContent({ agents }: AgentsContentProps) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents installed"
        description="meowthd reports zero local backends; install at least one (claude / copilot / codex / hermes / pi) to run sessions."
      />
    );
  }
  return (
    <Card className="overflow-hidden">
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
          {agents.map((agent) => (
            <TableRow key={agent.type}>
              <TableCell className="font-medium">{displayLabel(agent.type)}</TableCell>
              <TableCell>
                <Badge variant={agent.installed ? 'success' : 'outline'} dot>
                  {agent.installed ? 'Yes' : 'No'}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-basalt-muted-foreground">
                {agent.executable || '—'}
              </TableCell>
              <TableCell className="font-mono text-xs text-basalt-muted-foreground">
                {agent.version || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
