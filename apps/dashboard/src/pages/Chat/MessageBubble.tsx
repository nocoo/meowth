import MessageText from '@/components/MessageText';
import type { Envelope } from '@/models/types';
import { Link } from 'react-router';

// docs/features/03 §5.1 dispatch table + §5.2 sanitizer rule +
// §5.3 truncation. Renders a single envelope. The wrapping turn
// container concatenates streamed `message.kind=text` envelopes
// upstream; this component is type-by-type and stateless.
//
// All untrusted dynamic strings flow through `<MessageText>`
// (07 §4); literal labels and the static truncation suffix do
// not. `tool-use.input` is JSON.stringify'd before sanitization
// per §5.2.

export interface MessageBubbleProps {
  envelope: Envelope;
}

// §5.3 client-side render caps. Hard caps; oversize text is
// truncated and a "view in Sessions detail" Link is appended.
const TEXT_CONTENT_CAP = 8 * 1024;
const TOOL_USE_INPUT_CAP = 200;
const TOOL_RESULT_OUTPUT_CAP = 4 * 1024;

function readPayload(env: Envelope): Record<string, unknown> {
  return (env.payload as Record<string, unknown> | null | undefined) ?? {};
}

function readField(bag: Record<string, unknown>, key: string): unknown {
  return bag[key];
}

function payloadString(env: Envelope, key: string): string {
  const raw = readField(readPayload(env), key);
  return typeof raw === 'string' ? raw : '';
}

function payloadNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  // >=1_000 → N.Nk, floor to 1 decimal so the displayed value
  // never overstates the underlying count.
  return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
}

interface TruncatedTextProps {
  content: string;
  cap: number;
  sessionId: string;
}

function TruncatedText({ content, cap, sessionId }: TruncatedTextProps) {
  if (content.length <= cap) {
    return <MessageText content={content} />;
  }
  return (
    <div>
      <MessageText content={content.slice(0, cap)} />
      <div className="text-muted-foreground text-xs mt-1">
        …(truncated,{' '}
        <Link to={`/sessions/${sessionId}`} className="underline">
          view in Sessions detail
        </Link>
        )
      </div>
    </div>
  );
}

interface UsageBadgeProps {
  envelope: Envelope;
}

function UsageBadge({ envelope }: UsageBadgeProps) {
  const payload = readPayload(envelope);
  const modelsRaw = readField(payload, 'models');
  if (modelsRaw === null || typeof modelsRaw !== 'object') {
    return <span className="text-xs text-muted-foreground font-mono">-</span>;
  }
  const entries = Object.values(modelsRaw as Record<string, unknown>);
  if (entries.length === 0) {
    // §5.4 allows the map itself to be present but empty (no model
    // ever produced usage in this session, e.g. copilot mid-session
    // gap). Show `-` to match the missing-map case.
    return <span className="text-xs text-muted-foreground font-mono">-</span>;
  }
  let totalIn = 0;
  let totalOut = 0;
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    totalIn += payloadNumber(readField(m, 'input_tokens'));
    totalOut += payloadNumber(readField(m, 'output_tokens'));
  }
  return (
    <span className="text-xs text-muted-foreground font-mono">
      {formatTokens(totalIn)} in / {formatTokens(totalOut)} out
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface SessionEndedFooterProps {
  envelope: Envelope;
}

function SessionEndedFooter({ envelope }: SessionEndedFooterProps) {
  const status = payloadString(envelope, 'status');
  const error = payloadString(envelope, 'error');
  const rawDuration = readField(readPayload(envelope), 'duration_ms');
  const durationMs = payloadNumber(rawDuration);

  let prefix = '';
  let suffix = '';
  if (status === 'completed') {
    prefix = '✓ completed';
    if (durationMs > 0) suffix = ` in ${formatDuration(durationMs)}`;
  } else if (status === 'failed') {
    prefix = '✗ failed';
    if (error.length > 0) suffix = `: ${error}`;
  } else if (status === 'cancelled') {
    prefix = '⊘ cancelled';
  } else if (status === 'aborted') {
    prefix = '⊘ aborted';
  } else if (status === 'timeout') {
    prefix = '⏱ timeout';
  } else {
    prefix = status;
  }

  return (
    <div data-bubble-kind="session-ended" className="text-muted-foreground text-xs italic">
      {prefix}
      {suffix.length > 0 ? <MessageText content={suffix} /> : null}
    </div>
  );
}

function MessageEnvelope({ envelope }: MessageBubbleProps) {
  const kind = payloadString(envelope, 'kind');
  const sessionId = envelope.session_id;

  if (kind === 'text') {
    const content = payloadString(envelope, 'content');
    return (
      <div data-bubble-kind="text" className="bg-card rounded-md p-2">
        <TruncatedText content={content} cap={TEXT_CONTENT_CAP} sessionId={sessionId} />
      </div>
    );
  }

  if (kind === 'thinking') {
    const content = payloadString(envelope, 'content');
    return (
      <details data-bubble-kind="thinking" className="text-muted-foreground">
        <summary>Thinking...</summary>
        <MessageText content={content} />
      </details>
    );
  }

  if (kind === 'tool-use') {
    const tool = payloadString(envelope, 'tool');
    const input = readField(readPayload(envelope), 'input');
    const serialized = (() => {
      try {
        return JSON.stringify(input ?? null);
      } catch {
        return '<unserializable>';
      }
    })();
    return (
      <div data-bubble-kind="tool-use" className="bg-card rounded-md p-2 border">
        <div className="text-xs font-semibold">tool: {tool}</div>
        <TruncatedText content={serialized} cap={TOOL_USE_INPUT_CAP} sessionId={sessionId} />
      </div>
    );
  }

  if (kind === 'tool-result') {
    const output = payloadString(envelope, 'output');
    return (
      <div data-bubble-kind="tool-result" className="bg-card rounded-md p-2 border">
        <div className="text-xs font-semibold">tool result</div>
        <TruncatedText content={output} cap={TOOL_RESULT_OUTPUT_CAP} sessionId={sessionId} />
      </div>
    );
  }

  if (kind === 'error') {
    // 02 §5.3 maps `agent.Message.Content` → `payload.content` for
    // `text / error / log`, so a backend-side application error
    // arrives as `kind=error, content="..."`. The doc-level
    // `title / detail` fields are tolerated as a fallback so the
    // bubble degrades gracefully if a future schema variant uses
    // them, but the primary source of truth is `content`.
    const content = payloadString(envelope, 'content');
    const title = payloadString(envelope, 'title');
    const detail = payloadString(envelope, 'detail');
    return (
      <div
        data-bubble-kind="error"
        className="bg-destructive/10 text-destructive rounded-md p-2 border border-destructive/40"
      >
        {content.length > 0 ? <MessageText content={content} /> : null}
        {title.length > 0 ? <MessageText content={title} /> : null}
        {detail.length > 0 ? <MessageText content={detail} /> : null}
      </div>
    );
  }

  if (kind === 'log') {
    const content = payloadString(envelope, 'content');
    return (
      <details data-bubble-kind="log" className="text-muted-foreground text-xs">
        <summary>log</summary>
        <MessageText content={content} />
      </details>
    );
  }

  // `status` (provisional backend_session_id only — never rendered)
  // and any unknown kind fall through to null.
  return null;
}

export default function MessageBubble({ envelope }: MessageBubbleProps) {
  switch (envelope.type) {
    case 'session_started':
      return null;
    case 'heartbeat':
      return null;
    case 'message':
      return <MessageEnvelope envelope={envelope} />;
    case 'usage':
      return (
        <div data-bubble-kind="usage" className="flex justify-end">
          <UsageBadge envelope={envelope} />
        </div>
      );
    case 'error': {
      // daemon-side protocol error (02 §5.6). Yellow inline,
      // distinct from `message.kind=error` which is red.
      const code = payloadString(envelope, 'code');
      const title = payloadString(envelope, 'title');
      return (
        <div
          data-bubble-kind="protocol-error"
          className="bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-100 rounded-md p-2 border border-yellow-400"
        >
          {code.length > 0 ? <MessageText content={code} /> : null}
          {title.length > 0 ? <MessageText content={title} /> : null}
        </div>
      );
    }
    case 'session_ended': {
      // 02 §5.5 — `payload.status` is the daemon's terminal value;
      // `duration_ms` and `error` are siblings. The §5.1 dispatch
      // table promises a short status row with shape
      // `✓ completed in 4.2s` / `✗ failed: <error>` / `⊘ cancelled`;
      // we render the closest deterministic equivalent without
      // pulling in icon components.
      return <SessionEndedFooter envelope={envelope} />;
    }
    default:
      return null;
  }
}
