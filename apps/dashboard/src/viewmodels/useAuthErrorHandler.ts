import { isApiError } from '@/lib/api';
import { clearStoredToken } from '@/lib/localStorage';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

// docs/architecture/06 §10 — shared 401 handling for protected
// viewmodels. Returns a stable `handleError(err)` callback that:
//   - HTTP 401            → clearStoredToken + navigate('/setup', replace), returns null
//   - other ApiError      → returns `problem.title` (no token clear, no redirect)
//   - network rejection   → returns 'Daemon unreachable.' (no token clear)
//
// Viewmodels use the returned callback directly inside useEffect
// dependency arrays — it is `useCallback`-stable across renders.

const DAEMON_UNREACHABLE = 'Daemon unreachable. Check that meowthd is running and accessible.';

export type AuthErrorHandler = (err: unknown) => string | null;

export default function useAuthErrorHandler(): AuthErrorHandler {
  const navigate = useNavigate();
  return useCallback(
    (err: unknown): string | null => {
      if (isApiError(err)) {
        if (err.status === 401) {
          clearStoredToken();
          navigate('/setup', { replace: true });
          return null;
        }
        return err.problem.title;
      }
      return DAEMON_UNREACHABLE;
    },
    [navigate],
  );
}
