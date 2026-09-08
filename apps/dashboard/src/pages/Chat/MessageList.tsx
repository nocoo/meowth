import CopyButton from '@/components/CopyButton';
import MessageText from '@/components/MessageText';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { chatStatusLabel } from '@/lib/labels';
import type { ChatTurn, Envelope } from '@/viewmodels/useChatViewModel';
import { ChatBubble } from '@nocoo/basalt/components/chat-bubble';
import { ArrowUpRight, Bot, RotateCcw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import MessageActivity from './MessageActivity';
import MessageBubble from './MessageBubble';
import { groupEnvelopes, groupMessageActivity, messageKind } from './messageGroups';

const MAX_ENVELOPES_PER_TURN = 1000;

export interface MessageListProps {
  turns: readonly ChatTurn[];
  agentName: string;
  onRetry(): void;
}

function textOf(envelope: Envelope): string {
  const payload = envelope.payload as { kind?: string; content?: string };
  return envelope.type === 'message' &&
    payload.kind === 'text' &&
    typeof payload.content === 'string'
    ? payload.content
    : '';
}

export default function MessageList({ turns, agentName, onRetry }: MessageListProps) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 px-2 text-center">
        <Sparkles
          className="h-8 w-8 text-basalt-foreground"
          strokeWidth={1.25}
          aria-hidden="true"
        />
        <div className="space-y-3">
          <h3
            className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[34px]"
            data-slot="chat-empty-hint"
          >
            What can we work on?
          </h3>
          <p className="text-sm leading-6 text-basalt-muted-foreground">
            A fresh conversation with {agentName}. Where shall we start?
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-10 sm:space-y-12">
      {turns.map((turn, index) => {
        const overflow = turn.envelopes.length > MAX_ENVELOPES_PER_TURN;
        const groups = groupEnvelopes(turn.envelopes.slice(0, MAX_ENVELOPES_PER_TURN));
        const content = groups.filter(
          (envelope) => envelope.type !== 'session_ended' && envelope.type !== 'usage',
        );
        const metadata = groups.filter(
          (envelope) => envelope.type === 'session_ended' || envelope.type === 'usage',
        );
        const pending =
          turn.status === 'streaming' && index === turns.length - 1 && content.length === 0;
        const lastContent = content.at(-1);
        const writing =
          turn.status === 'streaming' &&
          lastContent !== undefined &&
          messageKind(lastContent) === 'text';
        const responseText = groups.map(textOf).filter(Boolean).join('\n\n');
        const canRetry =
          index === turns.length - 1 && turn.status !== 'streaming' && turn.status !== 'completed';
        return (
          <article key={turn.id} aria-label={`Turn ${index + 1}`} className="min-w-0 space-y-7">
            <ChatBubble
              variant="user"
              className="chat-user-bubble max-w-[90%] px-4 py-3 text-[15px] leading-6 sm:max-w-[85%] sm:px-5"
            >
              <MessageText
                content={turn.userPrompt}
                className="font-basalt-sans text-[15px] leading-6"
              />
            </ChatBubble>
            <div className="space-y-3">
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
                          streaming={
                            turn.status === 'streaming' && groupIndex === allGroups.length - 1
                          }
                        />
                      ) : (
                        <MessageBubble key={group.seq} envelope={group.envelope} />
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
              ) : null}
              {overflow ? <CapBanner sessionId={turn.sessionId} /> : null}
              {turn.error ? (
                <Notice variant="destructive" role="alert">
                  <MessageText content={turn.error} className="font-basalt-sans text-sm" />
                </Notice>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
                <div className="order-2 flex flex-wrap items-center gap-3">
                  {metadata.map((envelope) => (
                    <MessageBubble key={envelope.seq} envelope={envelope} />
                  ))}
                  {turn.status !== 'streaming' &&
                  !metadata.some((envelope) => envelope.type === 'session_ended') ? (
                    <span
                      data-slot="chat-turn-state"
                      className="text-xs text-basalt-muted-foreground"
                    >
                      {chatStatusLabel(turn.status)}
                    </span>
                  ) : null}
                </div>
                {turn.status !== 'streaming' ? (
                  <div className="-ml-2 flex flex-wrap items-center gap-0.5">
                    {responseText ? (
                      <CopyButton text={responseText} label="Copy response" iconOnly />
                    ) : null}
                    {canRetry ? (
                      <Button variant="ghost" size="xs" onClick={onRetry}>
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        Retry response
                      </Button>
                    ) : null}
                    {turn.sessionId ? (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon-sm"
                        className="text-basalt-muted-foreground"
                      >
                        <Link
                          to={`/sessions/${turn.sessionId}`}
                          aria-label="Session details"
                          title="Session details"
                        >
                          <ArrowUpRight
                            className="h-3.5 w-3.5"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
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
