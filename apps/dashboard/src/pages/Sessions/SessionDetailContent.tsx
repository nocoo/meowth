import MessageText from '@/components/MessageText';
import SessionStatusBadge from '@/components/SessionStatusBadge';
import { Card } from '@/components/ui/card';
import { displayLabel } from '@/lib/labels';
import type { SessionInfo, SessionMessageRow } from '@/viewmodels/useSessionDetailViewModel';

export interface SessionDetailContentProps {
  session: SessionInfo;
  messages: readonly SessionMessageRow[];
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function MessageEnvelope({ env }: { env: SessionMessageRow }) {
  const text = payloadString(env.payload, 'content') ?? payloadString(env.payload, 'output') ?? '';
  return (
    <div className="border-basalt-border border-t py-3 first:border-t-0 first:pt-0">
      <div className="text-basalt-muted-foreground text-xs">
        Sequence {env.seq} · {env.ts}
      </div>
      <MessageText content={text} />
    </div>
  );
}

function StatusRow({ env, label }: { env: SessionMessageRow; label: string }) {
  const detail = payloadString(env.payload, 'detail');
  const reason = payloadString(env.payload, 'reason');
  const value = detail ?? reason;
  return (
    <div
      className="border-basalt-border border-t py-3 text-sm first:border-t-0 first:pt-0"
      data-testid={`status-row-${env.type}`}
    >
      <span className="text-basalt-muted-foreground text-xs">
        Sequence {env.seq} · {env.ts}
      </span>
      <p>
        <strong>{label}</strong>
        {value !== null ? <span className="ml-2 font-mono text-xs">{value}</span> : null}
      </p>
    </div>
  );
}

function renderEnvelope(env: SessionMessageRow): React.ReactNode {
  switch (env.type) {
    case 'heartbeat':
      return null;
    case 'message':
      return <MessageEnvelope key={env.seq} env={env} />;
    case 'error':
      return <StatusRow key={env.seq} env={env} label="Error" />;
    case 'session_ended':
      return <StatusRow key={env.seq} env={env} label="Session ended" />;
    case 'session_started':
      return <StatusRow key={env.seq} env={env} label="Session started" />;
    case 'usage':
      return null;
    default:
      return null;
  }
}

export default function SessionDetailContent({ session, messages }: SessionDetailContentProps) {
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-6">
        <p
          className="text-basalt-muted-foreground font-mono text-xs"
          data-testid="session-detail-id"
        >
          {session.id}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong>{displayLabel(session.backend_type)}</strong>
          <SessionStatusBadge status={session.status} />
          <span className="text-basalt-muted-foreground">{session.model}</span>
        </div>
        <p className="text-basalt-muted-foreground text-xs">
          Started {session.started_at}
          {session.ended_at !== null ? ` · Ended ${session.ended_at}` : ''}
        </p>
      </Card>
      <Card className="p-6" data-testid="session-messages">
        {messages.map(renderEnvelope)}
      </Card>
    </div>
  );
}
