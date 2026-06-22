import { getSession, getSessionMessages } from '@/models/sessions';
import type { Envelope, Session } from '@/models/types';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// 06 §7.3 — Session detail viewmodel.
// Snapshot-only: daemon does not support follow=true, so we loop
// snapshot pages while has_more is true. Guard against a stuck
// daemon by aborting when next_after_seq does not advance.

const MAX_SNAPSHOT_PAGES = 200;

// Re-export the message-row shape so the page never imports
// `@/models/*` directly (06 §6.1: page only consumes viewmodel/
// components types).
export type SessionMessageRow = Envelope;
export type SessionInfo = Session;

export type SessionDetailStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; session: Session; messages: readonly Envelope[] }
  | { kind: 'error'; message: string };

export interface SessionDetailViewModel {
  sessionId: string;
  status: SessionDetailStatus;
  refresh(): void;
}

export default function useSessionDetailViewModel(sessionId: string): SessionDetailViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<SessionDetailStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    if (sessionId === '') {
      setStatus({ kind: 'error', message: 'Missing session id.' });
      return;
    }
    setStatus({ kind: 'loading' });

    async function load(): Promise<void> {
      try {
        const session = await getSession(sessionId);
        if (cancelled) return;
        const collected: Envelope[] = [];
        // Daemon defaults after_seq to -1 when the param is
        // omitted and returns events with seq > after_seq, so
        // omitting after_seq on the first request includes the
        // seq=0 envelope. We send after_seq on follow-up pages
        // only, anchored to next_after_seq from the previous
        // page.
        let afterSeq: number | null = null;
        let pages = 0;
        while (true) {
          const opts: { after_seq?: number } = afterSeq === null ? {} : { after_seq: afterSeq };
          const page = await getSessionMessages(sessionId, opts);
          if (cancelled) return;
          collected.push(...page.events);
          if (!page.has_more) break;
          if (afterSeq !== null && page.next_after_seq <= afterSeq) {
            setStatus({
              kind: 'error',
              message: 'Daemon returned non-advancing message page; aborting.',
            });
            return;
          }
          afterSeq = page.next_after_seq;
          pages += 1;
          if (pages >= MAX_SNAPSHOT_PAGES) {
            setStatus({
              kind: 'error',
              message: `Stopped after ${MAX_SNAPSHOT_PAGES} snapshot pages.`,
            });
            return;
          }
        }
        // Sort by seq just in case the daemon returned unordered.
        collected.sort((a, b) => a.seq - b.seq);
        setStatus({ kind: 'ready', session, messages: collected });
      } catch (err: unknown) {
        if (cancelled) return;
        const message = handleAuthError(err);
        if (message !== null) setStatus({ kind: 'error', message });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, handleAuthError, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { sessionId, status, refresh };
}
