import { Button } from '@nocoo/basalt/components/button';
import { Textarea } from '@nocoo/basalt/components/textarea';
import { Send, Square } from '@nocoo/basalt/icons';
import { type KeyboardEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ChatComposerProps {
  label: string;
  placeholder?: string;
  sendLabel?: string;
  cancelLabel?: string;
  streaming?: boolean;
  disabled?: boolean;
  className?: string;
  onSend: (message: string) => void | Promise<void>;
  onCancel: () => void;
}

export function ChatComposer({
  label,
  placeholder,
  sendLabel = 'Send',
  cancelLabel = 'Stop',
  streaming = false,
  disabled = false,
  className,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const composing = useRef(false);
  const canSubmit = !disabled && !streaming && draft.trim().length > 0;

  const submit = () => {
    const message = draft.trim();
    if (!canSubmit) return;
    setDraft('');
    void onSend(message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      composing.current ||
      event.nativeEvent.isComposing ||
      (event as KeyboardEvent<HTMLTextAreaElement> & { isComposing?: boolean }).isComposing
    )
      return;
    event.preventDefault();
    submit();
  };

  return (
    <div className={cn(className)}>
      <div>
        <Textarea
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <Button type="button" size="icon" aria-label={cancelLabel} onClick={onCancel}>
            <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            aria-label={sendLabel}
            disabled={!canSubmit}
            onClick={submit}
          >
            <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
