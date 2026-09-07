import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={label}
      className="shrink-0 text-basalt-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus('copied');
        } catch {
          setStatus('error');
        }
      }}
    >
      {status === 'copied' ? (
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      )}
      <span aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed · Retry' : label}
      </span>
    </Button>
  );
}
