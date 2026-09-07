import MessageText from '@/components/MessageText';
import type { ChatTurn } from '@/viewmodels/useChatViewModel';
import { Link } from 'react-router';
import MessageBubble from './MessageBubble';
import { groupEnvelopes } from './messageGroups';

// docs/features/03 §5.3 — single-turn envelope cap. V1 stops
// appending after 1000 envelopes per turn and surfaces a banner;
// no virtual scroll, no infinite list (the doc is explicit).
const MAX_ENVELOPES_PER_TURN = 1000;

export interface MessageListProps {
  turns: readonly ChatTurn[];
}

export default function MessageList({ turns }: MessageListProps) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-basalt-card bg-basalt-secondary text-basalt-muted-foreground ring-1 ring-basalt-border/50">
          <MessageSquare className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="text-base font-medium" data-slot="chat-empty-hint">
          Start a conversation.
        </p>
        <p className="max-w-sm text-sm leading-6 text-basalt-muted-foreground">
          Choose a local agent and send a message to get started.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full space-y-6">
      {turns.map((turn, ti) => {
        const overflow = turn.envelopes.length > MAX_ENVELOPES_PER_TURN;
        // Apply the §5.3 hard cap on the RAW envelopes first, then
        // coalesce consecutive text for rendering (§5.1). The cap
        // counts raw envelopes so a chatty per-token backend can't
        // dodge it by merging; grouping only changes how the capped
        // window is displayed.
        const capped = overflow ? turn.envelopes.slice(0, MAX_ENVELOPES_PER_TURN) : turn.envelopes;
        const groups = groupEnvelopes(capped);
        // §4.4 streaming state: while the LAST turn is streaming but
        // no visible assistant content has arrived yet, show a
        // restrained pending cursor. `groups` is already the
        // visible-content projection (groupEnvelopes drops
        // session_started / heartbeat / message.kind=status), so an
        // empty groups list during streaming is exactly "submitted,
        // nothing rendered yet" — the cold-start window where slow
        // backends (copilot ~10s, hermes ~70s) would otherwise look
        // dead. The first text/tool/thinking/error/log envelope
        // populates `groups` and the pending bubble disappears.
        //
        // The `ti === turns.length - 1` guard enforces the render
        // contract locally: only the final turn can show pending,
        // even if an earlier (defensively) still-streaming turn
        // somehow reaches the list — the viewmodel keeps only the
        // last turn streaming, but MessageList does not rely on that.
        const isLastTurn = ti === turns.length - 1;
        const showPending = isLastTurn && turn.status === 'streaming' && groups.length === 0;
        return (
          <article
            // The turn list is append-only within a chat; the
            // index is a stable identifier for the turn's
            // position. Slicing would shift indices but Chat V1
            // never deletes a turn mid-list.
            // biome-ignore lint/suspicious/noArrayIndexKey: turn list is append-only
            key={ti}
            aria-label={`Turn ${ti + 1}`}
            className="space-y-4"
          >
            <div className="flex justify-end">
              <LayerCard
                padding="none"
                outlined
                className="max-w-[min(36rem,85%)] rounded-2xl px-4 py-3"
              >
                <MessageText
                  content={turn.userPrompt}
                  className="font-basalt-sans text-[15px] leading-6"
                />
              </LayerCard>
            </div>
            {overflow ? <CapBanner sessionId={turn.sessionId} /> : null}
            {groups.map((env, i) => (
              <MessageBubble
                // Envelope `seq` is monotonic per session; the
                // index suffix only matters for the single
                // zero-seq case (session_started at seq=0 is
                // unique anyway) and for merged text runs that
                // reuse their first envelope's seq.
                key={`${env.seq}-${i}`}
                envelope={env}
              />
            ))}
            {showPending ? <PendingBubble /> : null}
          </article>
        );
      })}
    </div>
  );
}

function PendingBubble() {
  return (
    <div
      data-bubble-kind="streaming-pending"
      className="text-basalt-muted-foreground text-[15px] leading-7"
      aria-label="Waiting for response"
    >
      <span className="inline-block animate-pulse">…</span>
    </div>
  );
}

interface CapBannerProps {
  sessionId: string | null;
}

function CapBanner({ sessionId }: CapBannerProps) {
  return (
    <div
      role="alert"
      data-slot="chat-cap-banner"
      className="rounded-basalt-widget border border-basalt-warning/20 bg-basalt-warning-tint p-3 text-sm text-basalt-warning"
    >
      Cumulative envelope cap (1000) reached;{' '}
      {sessionId !== null ? (
        <Link to={`/sessions/${sessionId}`} className="underline">
          view in Sessions detail
        </Link>
      ) : (
        <span>view in Sessions detail</span>
      )}
    </div>
  );
}
import { LayerCard } from '@nocoo/basalt';
import { MessageSquare } from 'lucide-react';
