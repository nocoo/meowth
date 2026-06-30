import MessageText from '@/components/MessageText';
import type { ChatTurn } from '@/models/chat';
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
      <p className="text-muted-foreground text-sm italic" data-slot="chat-empty-hint">
        Start a conversation.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {turns.map((turn, ti) => {
        const overflow = turn.envelopes.length > MAX_ENVELOPES_PER_TURN;
        // Apply the §5.3 hard cap on the RAW envelopes first, then
        // coalesce consecutive text for rendering (§5.1). The cap
        // counts raw envelopes so a chatty per-token backend can't
        // dodge it by merging; grouping only changes how the capped
        // window is displayed.
        const capped = overflow ? turn.envelopes.slice(0, MAX_ENVELOPES_PER_TURN) : turn.envelopes;
        const groups = groupEnvelopes(capped);
        return (
          <article
            // The turn list is append-only within a chat; the
            // index is a stable identifier for the turn's
            // position. Slicing would shift indices but Chat V1
            // never deletes a turn mid-list.
            // biome-ignore lint/suspicious/noArrayIndexKey: turn list is append-only
            key={ti}
            aria-label={`Turn ${ti + 1}`}
            className="space-y-2"
          >
            <div className="bg-accent rounded-md p-2">
              <MessageText content={turn.userPrompt} />
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
          </article>
        );
      })}
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
      className="bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-100 border border-yellow-400 rounded-md p-2 text-xs"
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
