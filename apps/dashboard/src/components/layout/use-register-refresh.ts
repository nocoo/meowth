import { useEffect } from 'react';
import { useRefresh } from './refresh-context';

// Hook for Pages: register a viewmodel's refresh handler with
// the AppShell's RefreshContext for the lifetime of the Page.
//
// Usage:
//   const vm = useFooViewModel();
//   useRegisterRefresh(vm.refresh);
//
// Re-registers when the handler identity changes (viewmodels
// already return a stable useCallback so this rarely fires).
export function useRegisterRefresh(handler: () => void | Promise<void>): void {
  const { register } = useRefresh();
  useEffect(() => register(handler), [register, handler]);
}
