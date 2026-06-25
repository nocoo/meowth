import MessageText from '@/components/MessageText';
import type { SessionInfo, SessionMessageRow } from '@/viewmodels/useSessionDetailViewModel';

// docs/architecture/06 §7.3 + features/02 §4.4 — Phase 2 Stage C3b.
// Pure-props Content for SessionDetail. Owns the header row
// (id / backend / status / model / started / ended) and the
// `session-messages` envelope list. No vm, no route params.
//
// Envelope rendering preserves the C3a contract:
//   - message  : MessageText with payload.content ?? payload.output ?? ''
//   - error / session_ended / session_started → StatusRow
//   - heartbeat / usage → hidden (returns null)
// StatusRow exposes `data-testid="status-row-${env.type}"` and
// surfaces payload.detail (fallback payload.reason) inline.

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
    <div className="border-border border-t py-2">
      <div className="text-muted-foreground text-xs">
        seq {env.seq} · {env.ts}
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
    <div className="border-border border-t py-2 text-sm" data-testid={`status-row-${env.type}`}>
      <span className="text-muted-foreground text-xs">
        seq {env.seq} · {env.ts}
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
    <>
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground font-mono text-xs" data-testid="session-detail-id">
          {session.id}
        </p>
        <p>
          <strong>{session.backend_type}</strong> · {session.status} · {session.model}
        </p>
        <p className="text-muted-foreground text-xs">
          Started {session.started_at}
          {session.ended_at !== null ? ` · ended ${session.ended_at}` : ''}
        </p>
      </div>
      <div data-testid="session-messages">{messages.map(renderEnvelope)}</div>
    </>
  );
}
