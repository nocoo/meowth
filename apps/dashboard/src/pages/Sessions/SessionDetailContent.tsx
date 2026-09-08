import SessionStatusBadge from '@/components/SessionStatusBadge';
import AgentResponse from '@/components/chat/AgentResponse';
import { Card } from '@/components/ui/card';
import { displayLabel } from '@/lib/labels';
import type { SessionInfo, SessionMessageRow } from '@/viewmodels/useSessionDetailViewModel';

export interface SessionDetailContentProps {
  session: SessionInfo;
  messages: readonly SessionMessageRow[];
}

export default function SessionDetailContent({ session, messages }: SessionDetailContentProps) {
  return (
    <div className="chat-reading-column mx-auto min-w-0 w-full space-y-8">
      <Card className="space-y-3 p-4 sm:p-6">
        {session.thread_name ? (
          <h2 className="break-words text-base font-semibold">{session.thread_name}</h2>
        ) : null}
        <p
          className="break-all text-basalt-muted-foreground font-mono text-xs"
          data-testid="session-detail-id"
        >
          {session.id}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong>{displayLabel(session.backend_type)}</strong>
          <SessionStatusBadge status={session.status} />
          {session.model ? (
            <span className="break-all text-basalt-muted-foreground">{session.model}</span>
          ) : null}
        </div>
        <p className="text-basalt-muted-foreground text-xs leading-5">
          Started {session.started_at}
          {session.ended_at !== null ? ` · Ended ${session.ended_at}` : ''}
        </p>
      </Card>
      <div data-testid="session-messages">
        <AgentResponse
          envelopes={messages}
          agentName={displayLabel(session.backend_type)}
          status={session.status}
          fullOutput
          emptyMessage="No agent output has been recorded yet."
        />
      </div>
    </div>
  );
}
