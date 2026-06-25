import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Session } from '@/models/types';
import { ListTree } from 'lucide-react';
import { Link } from 'react-router';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3a.
// Pure-props Content component for SessionsList. Receives the
// resolved sessions list. Renders a 5-column table (Backend /
// Status / Model / Started / Thread) with a Link in the Backend
// cell pointing at /sessions/<id>. The Backend column keeps the
// click target so existing L3 specs that navigate via the link
// keep working.
//
// EmptyState shows only when the daemon legitimately reports an
// empty list. No SortHeader (reviewer correction #5: real sort
// state + tests would be a separate commit).
//
// Bug fix Commit 2 — wraps the table in a `rounded-card
// bg-secondary overflow-hidden` L2 surface so the data table
// sits on the white/secondary tier defined by 06 §5.1. The
// Link semantics + cell content are unchanged.

export interface SessionsListContentProps {
  sessions: readonly Session[];
}

export default function SessionsListContent({ sessions }: SessionsListContentProps) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="No sessions yet"
        description="Run an agent from the Agents page or via the daemon API; new sessions land here as they complete."
      />
    );
  }
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
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell className="font-mono">
                <Link to={`/sessions/${session.id}`} className="text-primary hover:underline">
                  {session.backend_type}
                </Link>
              </TableCell>
              <TableCell>{session.status}</TableCell>
              <TableCell className="font-mono text-xs">{session.model}</TableCell>
              <TableCell className="font-mono text-xs">{session.started_at}</TableCell>
              <TableCell className="text-xs">{session.thread_name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
