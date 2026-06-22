// docs/architecture/06 §8.3 — bearer storage wrapper.
//
// One key in window.localStorage, namespaced as `meowth_token`,
// reserved exclusively for the dashboard's API bearer. Setup
// codes (mws_*) never enter localStorage; doc 04 mints them and
// throws away the plaintext.
//
// Access is wrapped in try/catch so Safari private mode, browser
// quota errors, or cookie-disabled contexts degrade to "no token
// stored" rather than crashing the SPA boot.

const KEY = 'meowth_token';

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // No-op: the caller must treat persistence as best-effort.
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // No-op.
  }
}
