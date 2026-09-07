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
    if (!isStreaming && composer.canSend) composer.submit();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitIfAllowed();
      }}
      className="w-full"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-basalt-border bg-basalt-control p-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-basalt-ring focus-within:ring-2 focus-within:ring-basalt-ring/15">
        <Textarea
          rows={1}
          value={composer.input}
          onChange={(e) => composer.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitIfAllowed();
            }
          }}
          disabled={isStreaming}
          placeholder="Message…"
          aria-label="Message"
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 shadow-none focus-visible:ring-0"
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="mb-1 shrink-0 rounded-basalt-widget"
            aria-label="Cancel"
            onClick={() => composer.cancel()}
          >
            <Square className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            className="mb-1 shrink-0 rounded-basalt-widget"
            disabled={!composer.canSend}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>
      <p className="text-basalt-muted-foreground mt-2 px-1 text-xs">
        Enter to send · Shift+Enter for newline
      </p>
    </form>
  );
}
