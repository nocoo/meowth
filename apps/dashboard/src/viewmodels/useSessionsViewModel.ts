import { listSessions } from '@/models/sessions';
import type { Session } from '@/models/types';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

export type SessionsStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: readonly Session[] }
  | { kind: 'error'; message: string };

export interface SessionsViewModel {
  status: SessionsStatus;
  refresh(): void;
}

export default function useSessionsViewModel(): SessionsViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<SessionsStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    listSessions()
      .then((resp) => {
        if (cancelled) return;
        setStatus({ kind: 'ready', sessions: resp.sessions });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = handleAuthError(err);
        if (message !== null) setStatus({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { status, refresh };
}
