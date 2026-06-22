// docs/architecture/06 §7.6 / §9 — Setup viewmodel.
//
// Drives the /setup page through two modes (token paste vs mint
// via setup-code) and the protected-probe handshake on mode A.
//
// 04 §6.6 / 06 §9.2 disable mint in dev because Vite serves
// dashboard from a different origin than the daemon and mint
// requests would be cross-origin (uniform 404). The disabled
// state is exposed both through `mintDisabled` (so the UI can
// gray out the button) AND enforced inside `submitMint`, which
// no-ops with an error state instead of calling the model.

import { isApiError } from '@/lib/api';
import { clearStoredToken, setStoredToken } from '@/lib/localStorage';
import { fetchAgents } from '@/models/agents';
import { mintWithSetupCode } from '@/models/bootstrap';
import { useState } from 'react';
import { useNavigate } from 'react-router';

// Both token and setup-code share the same shape: prefix +
// 39-char RFC4648 base32 body. The redactor in 3.16 is broader
// (>=30 chars, [A-Z0-9]) on purpose to catch leaks; this is the
// strict validation contract.
const TOKEN_RE = /^mwt_[A-Z2-7]{39}$/;
const SETUP_CODE_RE = /^mws_[A-Z2-7]{39}$/;

const MINT_DISABLED_REASON = 'Mint via dashboard is only available in the production build.';
const UNIFIED_MINT_404 =
  'Setup not available. If you have a token already, paste it above; otherwise see daemon logs.';
const DAEMON_UNREACHABLE = 'Daemon unreachable. Check that meowthd is running and accessible.';
const TOKEN_INVALID = 'Token rejected by daemon. Double-check the value and try again.';
const TOKEN_SHAPE_INVALID = 'That does not look like a Meowth token. Expected mwt_ + 39 chars.';
const CODE_SHAPE_INVALID = 'That does not look like a setup-code. Expected mws_ + 39 chars.';
const EMPTY_INPUT_TOKEN = 'Paste your root token to continue.';
const EMPTY_INPUT_CODE = 'Paste the setup-code from `meowthd init --skip-token`.';

export type SetupMode = 'token' | 'mint';

export type SetupStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export interface SetupViewModel {
  mode: SetupMode;
  status: SetupStatus;
  mintDisabled: boolean;
  mintDisabledReason: string | null;
  setMode(mode: SetupMode): void;
  submitToken(token: string): Promise<void>;
  submitMint(setupCode: string): Promise<void>;
}

export interface UseSetupViewModelOptions {
  /**
   * Whether the mint flow should be disabled because the
   * dashboard is served from a different origin than the daemon
   * (see 06 §9.2 + 04 §6.6). Default reads `import.meta.env.DEV`
   * so production embed enables mint; tests inject the boolean
   * directly to avoid stubbing Vite globals.
   */
  isDev?: boolean;
}

export default function useSetupViewModel(options: UseSetupViewModelOptions = {}): SetupViewModel {
  const isDev = options.isDev ?? import.meta.env.DEV;
  const navigate = useNavigate();
  const [mode, setModeState] = useState<SetupMode>('token');
  const [status, setStatus] = useState<SetupStatus>({ kind: 'idle' });

  const mintDisabled = isDev === true;
  const mintDisabledReason = mintDisabled ? MINT_DISABLED_REASON : null;

  function setMode(next: SetupMode): void {
    setModeState(next);
    setStatus({ kind: 'idle' });
  }

  async function submitToken(token: string): Promise<void> {
    const value = token.trim();
    if (value === '') {
      setStatus({ kind: 'error', message: EMPTY_INPUT_TOKEN });
      return;
    }
    if (!TOKEN_RE.test(value)) {
      setStatus({ kind: 'error', message: TOKEN_SHAPE_INVALID });
      return;
    }
    setStatus({ kind: 'submitting' });
    setStoredToken(value);
    try {
      await fetchAgents();
      navigate('/overview', { replace: true });
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        clearStoredToken();
        setStatus({ kind: 'error', message: TOKEN_INVALID });
        return;
      }
      if (isApiError(err)) {
        // Any other HTTP failure: surface the problem title; do
        // not echo problem.detail (it may include daemon paths).
        setStatus({ kind: 'error', message: err.problem.title });
        return;
      }
      // Network / fetch rejection: keep the freshly stored token
      // (the user may want to retry); show daemon-unreachable.
      setStatus({ kind: 'error', message: DAEMON_UNREACHABLE });
    }
  }

  async function submitMint(setupCode: string): Promise<void> {
    if (mintDisabled) {
      // Defensive: the button is already disabled in the UI, but
      // the viewmodel refuses to make the request either way.
      setStatus({ kind: 'error', message: MINT_DISABLED_REASON });
      return;
    }
    const value = setupCode.trim();
    if (value === '') {
      setStatus({ kind: 'error', message: EMPTY_INPUT_CODE });
      return;
    }
    if (!SETUP_CODE_RE.test(value)) {
      setStatus({ kind: 'error', message: CODE_SHAPE_INVALID });
      return;
    }
    setStatus({ kind: 'submitting' });
    try {
      const resp = await mintWithSetupCode(value);
      setStoredToken(resp.secret);
      navigate('/overview', { replace: true });
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        // 04 §6.5 / 06 §9.2 — uniform 404. Switch back to mode A
        // so the user can try a bearer paste instead.
        setModeState('token');
        setStatus({ kind: 'error', message: UNIFIED_MINT_404 });
        return;
      }
      if (isApiError(err)) {
        setStatus({ kind: 'error', message: err.problem.title });
        return;
      }
      setStatus({ kind: 'error', message: DAEMON_UNREACHABLE });
    }
  }

  return {
    mode,
    status,
    mintDisabled,
    mintDisabledReason,
    setMode,
    submitToken,
    submitMint,
  };
}
