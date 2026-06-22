import { pingHealthz } from '@/models/health';
import { useCallback, useEffect, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// docs/architecture/06 §7.5 — Settings viewmodel (read-only v1).
// Wires only the healthz probe. No daemon config (bind / mode /
// log level) is exposed because no /v1/settings endpoint exists.

export type SettingsStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; daemonReachable: boolean }
  | { kind: 'error'; message: string };

export interface SettingsViewModel {
  status: SettingsStatus;
  /**
   * Build-time dashboard version exposed via Vite env. Falls back
   * to 'dev' when the env var is not set.
   */
  version: string;
  refresh(): void;
}

// biome-ignore lint/complexity/useLiteralKeys: import.meta.env access uses bracket form to satisfy TS noPropertyAccessFromIndexSignature
const DASHBOARD_VERSION = (import.meta.env['VITE_VERSION'] as string | undefined) ?? 'dev';

export default function useSettingsViewModel(): SettingsViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<SettingsStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    pingHealthz()
      .then(() => {
        if (!cancelled) setStatus({ kind: 'ready', daemonReachable: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = handleAuthError(err);
        if (message === null) return; // 401 → already redirecting
        // /healthz is unauthenticated so 401 should not happen,
        // but treat any failure as "not reachable" rather than
        // surfacing a problem.title that confuses the user.
        setStatus({ kind: 'ready', daemonReachable: false });
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { status, version: DASHBOARD_VERSION, refresh };
}
