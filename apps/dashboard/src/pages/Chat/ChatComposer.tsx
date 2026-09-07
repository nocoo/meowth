import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatComposer as ChatComposerVM } from '@/viewmodels/useChatViewModel';
import { ArrowUp, Square } from 'lucide-react';

// docs/features/03 §4.3 — composer renders a Textarea + a single
// trailing button that toggles between Send (non-streaming) and
// Cancel (streaming). Per the reviewer's modification: the
// component layer must double-guard `composer.canSend` so an
// `onSubmit` triggered via Enter cannot bypass the button's
// `disabled` state.

export interface ChatComposerProps {
  composer: ChatComposerVM;
  isStreaming: boolean;
}

export default function ChatComposer({ composer, isStreaming }: ChatComposerProps) {
  const submitIfAllowed = () => {
    if (composer.canSend) composer.submit();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitIfAllowed();
      }}
      className="w-full"
    >
      <div className="flex items-end gap-2 rounded-[1.5rem] bg-[color-mix(in_oklch,hsl(var(--basalt-foreground))_6%,hsl(var(--basalt-card)))] px-3 py-2 focus-within:bg-[color-mix(in_oklch,hsl(var(--basalt-foreground))_9%,hsl(var(--basalt-card)))]">
        <Textarea
          value={composer.input}
          onChange={(e) => composer.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitIfAllowed();
            }
          }}
          disabled={isStreaming}
          placeholder="Message…"
          aria-label="Message"
          className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="Cancel"
            onClick={() => composer.cancel()}
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            disabled={!composer.canSend}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </Button>
        )}
      </div>
      <p className="text-basalt-muted-foreground mt-1.5 px-1 text-[11px]">
        Enter to send · Shift+Enter for newline
      </p>
    </form>
  );
}
