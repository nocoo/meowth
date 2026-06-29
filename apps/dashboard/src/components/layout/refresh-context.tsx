import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';

// RefreshContext lets each Page register its viewmodel's
// `refresh()` so the AppShell header can render a single global
// "Refresh" button that re-pulls the current page's data.
//
// Why a context instead of per-page buttons:
//   - The header is a stable surface visible from every page,
//     so the same hand reaches the same place no matter where
//     the user is.
//   - Pages don't need to know about the button. They just call
//     `useRegisterRefresh(vm.refresh)` and the button appears
//     on mount, disappears on unmount.
//
// Behavior:
//   - At most ONE refresh handler is registered at a time. A
//     fresh registration replaces the prior one (StrictMode
//     double-mount and route changes both rely on this).
//   - `trigger()` awaits the handler's return value when it's a
//     Promise, so the button can show pending state until the
//     underlying fetch settles. Sync handlers (the common case —
//     `refresh()` returns void and re-runs an effect) resolve
//     immediately and the button only flashes pending; that's
//     fine for the user.
//   - Concurrent clicks are dropped while pending = true.

type RefreshHandler = () => void | Promise<void>;

interface RefreshContextValue {
  handler: RefreshHandler | null;
  pending: boolean;
  register(handler: RefreshHandler): () => void;
  trigger(): Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);
export { RefreshContext };

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [handler, setHandler] = useState<RefreshHandler | null>(null);
  const [pending, setPending] = useState(false);

  const register = useCallback((next: RefreshHandler) => {
    setHandler(() => next);
    return () => {
      // Only clear if we are still the active handler. Without
      // this guard, a fast Page A unmount that runs AFTER Page B
      // has registered would clear B's handler.
      setHandler((current) => (current === next ? null : current));
    };
  }, []);

  const trigger = useCallback(async () => {
    if (handler === null) return;
    if (pending) return;
    setPending(true);
    try {
      await handler();
    } finally {
      setPending(false);
    }
  }, [handler, pending]);

  return (
    <RefreshContext.Provider value={{ handler, pending, register, trigger }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (ctx === null) {
    throw new Error('useRefresh must be used within a RefreshProvider');
  }
  return ctx;
}
