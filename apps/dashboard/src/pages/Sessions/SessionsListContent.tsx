import { EmptyState } from '@/components/ui/empty-state';
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
        {sessions.map((session) => (
          <tr key={session.id} className="border-border border-t">
            <td className="py-2 pr-2 font-mono">
              <Link to={`/sessions/${session.id}`} className="text-primary hover:underline">
                {session.backend_type}
              </Link>
            </td>
            <td className="py-2 pr-2">{session.status}</td>
            <td className="py-2 pr-2 font-mono text-xs">{session.model}</td>
            <td className="py-2 pr-2 font-mono text-xs">{session.started_at}</td>
            <td className="py-2 pr-2 text-xs">{session.thread_name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
