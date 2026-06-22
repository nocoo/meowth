import { useCallback, useEffect, useId, useRef, useState } from 'react';

// docs/architecture/07 §7.1 — SecretReveal component contract.
//
// Default masked. The mask is a bullet string sized to the secret
// length so plaintext does not appear in DOM textContent until
// the user explicitly reveals. Copy reveals briefly, then restores.
// visibilitychange to hidden forces mask. Copy failures leave the
// mask intact and do not call onCopy.

const DEFAULT_REVEAL_RESTORE_MS = 3000;
const COPY_FAILED = 'Copy failed';
const COPIED = 'Copied';

export interface SecretRevealProps {
  secret: string;
  label?: string;
  onCopy?: () => void;
  initiallyMasked?: boolean;
  revealRestoreMs?: number;
}

function maskFor(secret: string): string {
  return '•'.repeat(secret.length);
}

export default function SecretReveal({
  secret,
  label,
  onCopy,
  initiallyMasked = true,
  revealRestoreMs = DEFAULT_REVEAL_RESTORE_MS,
}: SecretRevealProps) {
  const [masked, setMasked] = useState<boolean>(initiallyMasked);
  const [feedback, setFeedback] = useState<string | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldId = useId();

  // visibilitychange: force mask when the tab is hidden so a
  // shoulder-surfer or screenshot tool can't catch plaintext.
  useEffect(() => {
    function onVisibility(): void {
      if (document.visibilityState === 'hidden') {
        setMasked(true);
        if (restoreTimer.current !== null) {
          clearTimeout(restoreTimer.current);
          restoreTimer.current = null;
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Clean up any pending timers on unmount so fake-timer tests
  // do not leak.
  useEffect(() => {
    return () => {
      if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    };
  }, []);

  const toggleReveal = useCallback(() => {
    setMasked((prev) => !prev);
    if (restoreTimer.current !== null) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setMasked(false);
      onCopy?.();
      setFeedback(COPIED);
      if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
      restoreTimer.current = setTimeout(() => {
        setMasked(true);
        restoreTimer.current = null;
      }, revealRestoreMs);
      feedbackTimer.current = setTimeout(() => {
        setFeedback(null);
        feedbackTimer.current = null;
      }, revealRestoreMs);
    } catch {
      // Copy failed: keep mask, do not call onCopy, do not throw.
      setFeedback(COPY_FAILED);
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => {
        setFeedback(null);
        feedbackTimer.current = null;
      }, revealRestoreMs);
    }
  }, [secret, onCopy, revealRestoreMs]);

  const display = masked ? maskFor(secret) : secret;

  return (
    <div className="space-y-2" aria-label={label ?? 'Secret value'}>
      <output
        id={fieldId}
        data-testid="secret-reveal-value"
        className="bg-muted text-foreground block w-full break-all rounded border px-3 py-2 font-mono text-sm"
      >
        {display}
      </output>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={toggleReveal}
          className="border-input rounded border px-3 py-1 text-sm"
        >
          {masked ? 'Reveal' : 'Hide'}
        </button>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm"
        >
          Copy
        </button>
        {feedback !== null ? (
          <output data-testid="secret-reveal-feedback" className="text-muted-foreground text-xs">
            {feedback}
          </output>
        ) : null}
      </div>
    </div>
  );
}
