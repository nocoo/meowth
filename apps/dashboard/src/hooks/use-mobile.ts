import { useCallback, useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

/* v8 ignore start */
function getServerSnapshot(): boolean {
  // Default to false (desktop) on server to avoid layout shift. The
  // dashboard never runs under SSR (Vite SPA), but useSyncExternalStore
  // requires this hook; jsdom-based L1 cannot reach this line.
  return false;
}
/* v8 ignore stop */

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
      mql.addEventListener('change', callback);
      window.addEventListener('resize', callback);
      return () => {
        mql.removeEventListener('change', callback);
        window.removeEventListener('resize', callback);
      };
    },
    [breakpoint],
  );
  return useSyncExternalStore(subscribe, () => window.innerWidth < breakpoint, getServerSnapshot);
}
