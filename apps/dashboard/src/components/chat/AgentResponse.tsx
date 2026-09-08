import CopyButton from '@/components/CopyButton';
import MessageText from '@/components/MessageText';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { chatStatusLabel } from '@/lib/labels';
import type { ChatTurnStatus } from '@/models/chat';
import type { Envelope, Session } from '@/models/types';
import { ChatBubble } from '@nocoo/basalt/components/chat-bubble';
import { ArrowUpRight, Bot, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import MessageActivity from './MessageActivity';
import MessageBubble from './MessageBubble';
import { groupEnvelopes, groupMessageActivity, messageField, messageKind } from './messageGroups';
import './chat-transcript.css';

const MAX_ENVELOPES_PER_TURN = 1000;

export interface AgentResponseProps {
  envelopes: readonly Envelope[];
  agentName: string;
  status: ChatTurnStatus | Session['status'];
  sessionId?: string | null;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  showPending?: boolean;
  fullOutput?: boolean;
  emptyMessage?: string;
}

function textOf(envelope: Envelope): string {
  const content = messageField(envelope, 'content');
  return messageKind(envelope) === 'text' && typeof content === 'string' ? content : '';
}

export default function AgentResponse({
  envelopes,
  agentName,
  status,
  sessionId = null,
  error,
  onRetry,
  showPending = true,
  fullOutput = false,
  emptyMessage,
}: AgentResponseProps) {
  const streaming = status === 'streaming';
  const overflow = !fullOutput && envelopes.length > MAX_ENVELOPES_PER_TURN;
  const groups = groupEnvelopes(
    fullOutput ? envelopes : envelopes.slice(0, MAX_ENVELOPES_PER_TURN),
  );
  const content = groups.filter(
    (envelope) => envelope.type !== 'session_ended' && envelope.type !== 'usage',
  );
  const metadata = groups.filter(
    (envelope) => envelope.type === 'session_ended' || envelope.type === 'usage',
  );
  const pending = streaming && showPending && content.length === 0;
  const lastContent = content.at(-1);
  const writing = streaming && lastContent !== undefined && messageKind(lastContent) === 'text';
  const responseText = groups.map(textOf).filter(Boolean).join('\n\n');
  const resultCallIds = new Set(
    envelopes
      .filter((envelope) => messageKind(envelope) === 'tool-result')
      .map((envelope) => messageField(envelope, 'call_id'))
      .filter((id) => typeof id === 'string' && id.length > 0),
  );

  return (
    <section aria-label={`${agentName} response`} className="min-w-0 space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-basalt-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-basalt-border/60">
          <Bot className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </span>
        {agentName}
      </div>
      {content.length > 0 || pending ? (
        <ChatBubble
          variant="assistant"
          streaming={writing}
          className="chat-response min-w-0 w-full max-w-full ring-0"
        >
          <div className="min-w-0 space-y-4">
            {groupMessageActivity(content).map((group, groupIndex, allGroups) =>
              group.kind === 'activity' ? (
                <MessageActivity
                  key={group.seq}
                  envelopes={group.envelopes}
                  turnEnded={!streaming && status !== 'running'}
                  resultCallIds={resultCallIds}
                  streaming={streaming && groupIndex === allGroups.length - 1}
                  fullOutput={fullOutput}
                />
              ) : (
                <MessageBubble key={group.seq} envelope={group.envelope} fullOutput={fullOutput} />
              ),
            )}
            {pending ? (
              <div
                data-bubble-kind="streaming-pending"
                aria-label="Waiting for response"
                className="flex items-center gap-2 text-sm text-basalt-muted-foreground"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-basalt-primary motion-reduce:animate-none" />
                {agentName} is thinking…
              </div>
            ) : null}
          </div>
        </ChatBubble>
      ) : emptyMessage ? (
        <p className="text-sm leading-6 text-basalt-muted-foreground">{emptyMessage}</p>
      ) : null}
      {overflow ? <CapBanner sessionId={sessionId} /> : null}
      {error ? (
        <Notice variant="destructive" role="alert">
          <MessageText content={error} className="font-basalt-sans text-sm" />
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
        <div className="order-2 flex flex-wrap items-center gap-3">
          {metadata.map((envelope) => (
            <MessageBubble key={envelope.seq} envelope={envelope} />
          ))}
          {!streaming && !metadata.some((envelope) => envelope.type === 'session_ended') ? (
            <span data-slot="chat-turn-state" className="text-xs text-basalt-muted-foreground">
              {chatStatusLabel(status)}
            </span>
          ) : null}
        </div>
        {!streaming ? (
          <div className="-ml-2 flex flex-wrap items-center gap-0.5">
            {responseText ? (
              <CopyButton text={responseText} label="Copy response" iconOnly />
            ) : null}
            {onRetry ? (
              <Button variant="ghost" size="xs" onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Retry response
              </Button>
            ) : null}
            {sessionId ? (
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="text-basalt-muted-foreground"
              >
                <Link
                  to={`/sessions/${sessionId}`}
                  aria-label="Session details"
                  title="Session details"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CapBanner({ sessionId }: { sessionId: string | null }) {
  return (
    <Notice variant="warning" role="alert" data-slot="chat-cap-banner">
      This response is large.{' '}
      {sessionId !== null ? (
        <Link to={`/sessions/${sessionId}`} className="underline">
          View session details
        </Link>
      ) : (
        <span>View session details</span>
      )}{' '}
      for the full output.
    </Notice>
  );
}
