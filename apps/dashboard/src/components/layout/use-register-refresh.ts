import { useContext, useEffect } from 'react';
import { RefreshContext } from './refresh-context';

// Hook for Pages: register a viewmodel's refresh handler with
// the AppShell's RefreshContext for the lifetime of the Page.
//
// Usage:
//   const vm = useFooViewModel();
//   useRegisterRefresh(vm.refresh);
//
// Re-registers when the handler identity changes (viewmodels
// already return a stable useCallback so this rarely fires).
//
// Tolerates an absent provider: in production every Page lives
// under <AppShell> which wraps RefreshProvider, so the context
// is always present. Page-only L1 tests (or any future host that
// renders a Page outside the shell) simply get no-op registration
// — the header button will not exist, which is the right fallback.
// `useRefresh` itself still throws when consumed outside a
// provider (button + context unit tests want that contract).
export function useRegisterRefresh(handler: () => void | Promise<void>): void {
  const ctx = useContext(RefreshContext);
  useEffect(() => {
    if (ctx === null) return;
    return ctx.register(handler);
  }, [ctx, handler]);
}
