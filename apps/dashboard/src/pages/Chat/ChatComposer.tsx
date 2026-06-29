import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatComposer as ChatComposerVM } from '@/viewmodels/useChatViewModel';

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
      className="flex gap-2"
    >
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
        placeholder="Type your message..."
        aria-label="Message"
        className="flex-1"
      />
      {isStreaming ? (
        <Button type="button" variant="outline" onClick={() => composer.cancel()}>
          Cancel
        </Button>
      ) : (
        <Button type="submit" disabled={!composer.canSend}>
          Send
        </Button>
      )}
    </form>
  );
}
