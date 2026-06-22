import { getSession, getSessionMessages } from '@/models/sessions';
import type { Envelope, Session } from '@/models/types';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// 06 §7.3 — Session detail viewmodel.
// Snapshot-only: daemon does not support follow=true, so we loop
// snapshot pages while has_more is true. Guard against a stuck
// daemon by aborting when next_after_seq does not advance.

const MAX_SNAPSHOT_PAGES = 200;

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
        let afterSeq = 0;
        let pages = 0;
        while (true) {
          const page = await getSessionMessages(sessionId, { after_seq: afterSeq });
          if (cancelled) return;
          collected.push(...page.events);
          if (!page.has_more) break;
          if (page.next_after_seq <= afterSeq) {
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
