import MessageMarkdown from '@/components/MessageMarkdown';
import MessageText from '@/components/MessageText';
import { Notice } from '@/components/ui/notice';
import { displayLabel } from '@/lib/labels';
import type { Envelope } from '@/viewmodels/useChatViewModel';
import {
  Brain,
  Check,
  CircleDot,
  CircleSlash,
  Clock,
  type LucideIcon,
  ScrollText,
  Terminal,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import ActivityDisclosure from './ActivityDisclosure';

// docs/features/03 §5.1 dispatch table + §5.2 sanitizer rule +
// §5.3 truncation. Renders a single envelope. The wrapping turn
// container concatenates streamed `message.kind=text` envelopes
// upstream; this component is type-by-type and stateless.
//
// Assistant prose uses safe Markdown (feature 09); tool and log
// output stays literal through MessageText.

export interface MessageBubbleProps {
  envelope: Envelope;
  expanded?: boolean;
}

// §5.3 client-side render caps. Hard caps; oversize text is
// truncated and a "view in Sessions detail" Link is appended.
const TEXT_CONTENT_CAP = 8 * 1024;
const TOOL_USE_INPUT_CAP = 4 * 1024;
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
  className?: string;
  markdown?: boolean;
}

function TruncatedText({
  content,
  cap,
  sessionId,
  className = '',
  markdown = false,
}: TruncatedTextProps) {
  const Renderer = markdown ? MessageMarkdown : MessageText;
  if (content.length <= cap) {
    return <Renderer content={content} className={className} />;
  }
  return (
    <div>
      <Renderer content={content.slice(0, cap)} className={className} />
      <div className="text-basalt-muted-foreground text-xs mt-1">
        …(truncated,{' '}
        <Link to={`/sessions/${sessionId}`} className="underline">
          View session details
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
    return <span className="text-xs text-basalt-muted-foreground font-mono">-</span>;
  }
  const entries = Object.values(modelsRaw as Record<string, unknown>);
  if (entries.length === 0) {
    // §5.4 allows the map itself to be present but empty (no model
    // ever produced usage in this session, e.g. copilot mid-session
    // gap). Show `-` to match the missing-map case.
    return <span className="text-xs text-basalt-muted-foreground font-mono">-</span>;
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
    <span className="text-xs text-basalt-muted-foreground font-mono">
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

const STATUS_ICONS: Record<string, LucideIcon> = {
  completed: Check,
  failed: X,
  cancelled: CircleSlash,
  aborted: CircleSlash,
  timeout: Clock,
};

function SessionEndedFooter({ envelope }: SessionEndedFooterProps) {
  const status = payloadString(envelope, 'status');
  const error = payloadString(envelope, 'error');
  const rawDuration = readField(readPayload(envelope), 'duration_ms');
  const durationMs = payloadNumber(rawDuration);

  const Icon = STATUS_ICONS[status] ?? CircleDot;
  let label = displayLabel(status);
  if (status === 'completed' && durationMs > 0) label += ` in ${formatDuration(durationMs)}`;
  if (status === 'failed' && error.length > 0) label += `: ${error}`;

  return (
    <div
      data-bubble-kind="session-ended"
      className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-basalt-muted-foreground tabular-nums"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <MessageText content={label} className="font-basalt-sans text-xs leading-5" />
    </div>
  );
}

function MessageEnvelope({ envelope, expanded = false }: MessageBubbleProps) {
  const kind = payloadString(envelope, 'kind');
  const sessionId = envelope.session_id;

  if (kind === 'text') {
    const content = payloadString(envelope, 'content');
    return (
      <div data-bubble-kind="text" className="text-basalt-foreground text-base leading-7">
        <TruncatedText
          content={content}
          cap={TEXT_CONTENT_CAP}
          sessionId={sessionId}
          markdown
          className="font-basalt-sans text-base leading-7"
        />
      </div>
    );
  }

  if (kind === 'thinking' || kind === 'tool-use' || kind === 'tool-result' || kind === 'log') {
    const thinking = kind === 'thinking';
    const toolUse = kind === 'tool-use';
    const tool = payloadString(envelope, 'tool');
    const label = thinking
      ? 'Thinking'
      : toolUse
        ? displayLabel(tool) || 'Tool call'
        : kind === 'log'
          ? 'Log'
          : 'Tool result';
    const content = toolUse
      ? JSON.stringify(readField(readPayload(envelope), 'input') ?? null, null, 2)
      : payloadString(envelope, kind === 'tool-result' ? 'output' : 'content');
    const body = (
      <div className="min-w-0 space-y-2" data-bubble-kind={expanded ? kind : undefined}>
        <p className="text-xs font-medium text-basalt-muted-foreground">
          {toolUse ? 'Input' : label}
        </p>
        <div
          className={`max-h-80 overflow-auto overscroll-contain ${thinking ? 'pr-2' : 'rounded-xl border border-basalt-border/60 bg-basalt-secondary/50 p-3'}`}
        >
          <TruncatedText
            content={content}
            cap={
              thinking || kind === 'log'
                ? TEXT_CONTENT_CAP
                : toolUse
                  ? TOOL_USE_INPUT_CAP
                  : TOOL_RESULT_OUTPUT_CAP
            }
            sessionId={sessionId}
            markdown={thinking}
            className={thinking ? 'text-sm text-basalt-muted-foreground' : 'text-xs leading-5'}
          />
        </div>
      </div>
    );
    return expanded ? (
      body
    ) : (
      <ActivityDisclosure
        label={label}
        icon={thinking ? Brain : kind === 'log' ? ScrollText : Terminal}
        kind={kind}
      >
        {body}
      </ActivityDisclosure>
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
      <Notice data-bubble-kind="error" variant="destructive" role="alert">
        {content.length > 0 ? <MessageText content={content} /> : null}
        {title.length > 0 ? <MessageText content={title} /> : null}
        {detail.length > 0 ? <MessageText content={detail} /> : null}
      </Notice>
    );
  }

  // `status` (provisional backend_session_id only — never rendered)
  // and any unknown kind fall through to null.
  return null;
}

export default function MessageBubble({ envelope, expanded = false }: MessageBubbleProps) {
  switch (envelope.type) {
    case 'session_started':
      return null;
    case 'heartbeat':
      return null;
    case 'message':
      return <MessageEnvelope envelope={envelope} expanded={expanded} />;
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
        <Notice data-bubble-kind="protocol-error" variant="warning" role="alert">
          {code.length > 0 ? <MessageText content={code} /> : null}
          {title.length > 0 ? <MessageText content={title} /> : null}
        </Notice>
      );
    }
    case 'session_ended': {
      return <SessionEndedFooter envelope={envelope} />;
    }
    default:
      return null;
  }
}
