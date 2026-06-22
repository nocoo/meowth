import { fetchAgents } from '@/models/agents';
import type { Agent } from '@/models/types';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

export type AgentsStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; agents: readonly Agent[] }
  | { kind: 'error'; message: string };

export interface AgentsViewModel {
  status: AgentsStatus;
  refresh(): void;
}

export default function useAgentsViewModel(): AgentsViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<AgentsStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    fetchAgents()
      .then((resp) => {
        if (cancelled) return;
        setStatus({ kind: 'ready', agents: resp.agents });
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
