import { fetchAgents } from '@/models/agents';
import { pingHealthz } from '@/models/health';
import { listSessions } from '@/models/sessions';
import { listTokens } from '@/models/tokens';
import type { Agent, HealthzResponse, Session, TokenView } from '@/models/types';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// docs/architecture/06 §7.1 — Overview viewmodel.

interface OverviewData {
  health: HealthzResponse | null;
  tokens: readonly TokenView[];
  sessions: readonly Session[];
  agents: readonly Agent[];
}

export type OverviewStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; data: OverviewData }
  | { kind: 'error'; message: string };

export interface OverviewViewModel {
  status: OverviewStatus;
  refresh(): void;
}

export default function useOverviewViewModel(): OverviewViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<OverviewStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    Promise.all([
      pingHealthz().catch(() => null),
      listTokens(),
      listSessions({ limit: 10 }),
      fetchAgents(),
    ])
      .then(([health, tokensResp, sessionsResp, agentsResp]) => {
        if (cancelled) return;
        setStatus({
          kind: 'ready',
          data: {
            health,
            tokens: tokensResp.tokens,
            sessions: sessionsResp.sessions,
            agents: agentsResp.agents,
          },
        });
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
