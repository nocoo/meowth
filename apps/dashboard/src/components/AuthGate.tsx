import Spinner from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { clearStoredToken, getStoredToken } from '@/lib/localStorage';
import { fetchAgents } from '@/models/agents';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

// docs/architecture/06 §10 — AuthGate hydrate.
//
// Wraps the protected route tree only; /setup lives outside this
// component so we never need to conditionally short-circuit the
// hook order. The boot sequence is:
//
//   1. Read bearer from localStorage. None → redirect /setup.
//   2. Probe GET /v1/agents.
//      - 200             → render children.
//      - 401             → clearStoredToken + redirect /setup.
//      - non-401 ApiError or network reject → <DaemonUnreachable />.
//
// The probe only runs once per AuthGate mount. <DaemonUnreachable />
// exposes a Retry button that re-runs the probe via setProbeNonce.

type AuthPhase = 'probing' | 'ok' | 'unreachable';

function DaemonUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="bg-card text-card-foreground w-full max-w-md space-y-3 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Daemon unreachable</h1>
        <p className="text-muted-foreground text-sm">
          The Meowth daemon did not respond. Check that meowthd is running and reachable from this
          browser.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    </main>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<AuthPhase>('probing');
  const [probeNonce, setProbeNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: probeNonce drives onRetry() re-probes by design
  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (token === null || token === '') {
      navigate('/setup', { replace: true });
      return () => {
        cancelled = true;
      };
    }
    setPhase('probing');
    fetchAgents()
      .then(() => {
        if (!cancelled) setPhase('ok');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 401) {
          clearStoredToken();
          navigate('/setup', { replace: true });
          return;
        }
        setPhase('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, probeNonce]);

  const onRetry = useCallback(() => {
    setPhase('probing');
    setProbeNonce((n) => n + 1);
  }, []);

  if (phase === 'ok') return <>{children}</>;
  if (phase === 'unreachable') return <DaemonUnreachable onRetry={onRetry} />;
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <Spinner label="Verifying token..." />
    </main>
  );
}
