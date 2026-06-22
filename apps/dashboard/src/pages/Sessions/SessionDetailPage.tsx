import MessageText from '@/components/MessageText';
import useSessionDetailViewModel, {
  type SessionMessageRow,
} from '@/viewmodels/useSessionDetailViewModel';
import { useParams } from 'react-router';

// docs/architecture/06 §7.3 — Session detail page.
// Filters heartbeat from display; renders `message` payload
// content/output via MessageText (02 §5.3 splits tool-result
// text into payload.output, normal text into payload.content);
// surfaces `error` and `session_ended` as structured status rows.

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
  return (
    <div className="border-border border-t py-2 text-sm" data-testid={`status-row-${env.type}`}>
      <span className="text-muted-foreground text-xs">
        seq {env.seq} · {env.ts}
      </span>
      <p>
        <strong>{label}</strong>
        {(() => {
          const detail = payloadString(env.payload, 'detail');
          const reason = payloadString(env.payload, 'reason');
          const value = detail ?? reason;
          return value !== null ? <span className="ml-2 font-mono text-xs">{value}</span> : null;
        })()}
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

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const vm = useSessionDetailViewModel(sessionId);

  if (vm.status.kind === 'loading') {
    return (
      <section aria-labelledby="session-detail-heading" className="space-y-2">
        <h2 id="session-detail-heading" className="text-xl font-semibold">
          Session
        </h2>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </section>
    );
  }
  if (vm.status.kind === 'error') {
    return (
      <section aria-labelledby="session-detail-heading" className="space-y-2">
        <h2 id="session-detail-heading" className="text-xl font-semibold">
          Session
        </h2>
        <p className="text-muted-foreground font-mono text-xs" data-testid="session-detail-id">
          {vm.sessionId}
        </p>
        <p role="alert" className="text-destructive text-sm">
          {vm.status.message}
        </p>
      </section>
    );
  }

  const { session, messages } = vm.status;
  return (
    <section aria-labelledby="session-detail-heading" className="space-y-3">
      <h2 id="session-detail-heading" className="text-xl font-semibold">
        Session
      </h2>
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
    </section>
  );
}
