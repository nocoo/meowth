import { createToken, listTokens, revokeToken } from '@/models/tokens';
import type { TokenView } from '@/models/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

// docs/architecture/06 §7.4 + 07 §7.2 — Tokens viewmodel.
//
// The `tokens` list state holds the secret-free TokenView shape;
// plaintext from TokenCreateResponse only lives in modal.createdSecret
// for the duration of the reveal dialog and is cleared on close.

export type TokensStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; tokens: readonly TokenView[] }
  | { kind: 'error'; message: string };

export type ModalState =
  | { open: false }
  | { open: true; phase: 'idle'; name: string }
  | { open: true; phase: 'submitting'; name: string }
  | { open: true; phase: 'reveal'; createdSecret: string; createdName: string }
  | { open: true; phase: 'error'; name: string; message: string };

export interface TokensViewModel {
  status: TokensStatus;
  modal: ModalState;
  refresh(): void;
  openCreateModal(): void;
  closeCreateModal(): void;
  setCreateName(name: string): void;
  submitCreate(): Promise<void>;
  revoke(id: string): Promise<void>;
}

// TokenCreateResponse → TokenView (drops secret). Created tokens
// land in the list with no secret field.
function toTokenView(resp: {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  created_via: TokenView['created_via'];
}): TokenView {
  return {
    id: resp.id,
    name: resp.name,
    prefix: resp.prefix,
    created_at: resp.created_at,
    created_via: resp.created_via,
  };
}

export default function useTokensViewModel(): TokensViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [status, setStatus] = useState<TokensStatus>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [modal, setModal] = useState<ModalState>({ open: false });
  // Mirror modal into a ref so action callbacks can read the
  // current state without relying on a stateful setModal updater
  // (StrictMode double-invokes pure updaters, which would skew any
  // side-effectful capture we did inside one).
  const modalRef = useRef<ModalState>(modal);
  modalRef.current = modal;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives refresh() re-fetches by design
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    listTokens()
      .then((resp) => {
        if (cancelled) return;
        setStatus({ kind: 'ready', tokens: resp.tokens });
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

  const openCreateModal = useCallback(() => {
    setModal({ open: true, phase: 'idle', name: '' });
  }, []);

  const closeCreateModal = useCallback(() => {
    // 07 §7.2 #5: clear plaintext secret immediately on close.
    setModal({ open: false });
  }, []);

  const setCreateName = useCallback((name: string) => {
    setModal((prev) => {
      if (!prev.open) return prev;
      if (prev.phase === 'submitting' || prev.phase === 'reveal') return prev;
      return { open: true, phase: 'idle', name };
    });
  }, []);

  const submitCreate = useCallback(async (): Promise<void> => {
    const current = modalRef.current;
    if (!current.open) return;
    if (current.phase === 'submitting' || current.phase === 'reveal') return;
    const name = current.name.trim();
    if (name === '') {
      setModal({ open: true, phase: 'error', name: '', message: 'Name is required.' });
      return;
    }
    setModal({ open: true, phase: 'submitting', name });
    try {
      const resp = await createToken({ name });
      // Append the sanitized view (no secret) to the cached list.
      setStatus((prev) => {
        if (prev.kind !== 'ready') return prev;
        return { kind: 'ready', tokens: [toTokenView(resp), ...prev.tokens] };
      });
      // Hand the plaintext to the reveal phase only.
      setModal({
        open: true,
        phase: 'reveal',
        createdSecret: resp.secret,
        createdName: resp.name,
      });
    } catch (err: unknown) {
      const message = handleAuthError(err);
      if (message === null) {
        setModal({ open: false });
        return;
      }
      setModal({ open: true, phase: 'error', name, message });
    }
  }, [handleAuthError]);

  const revoke = useCallback(
    async (id: string): Promise<void> => {
      try {
        await revokeToken(id);
        setNonce((n) => n + 1);
      } catch (err: unknown) {
        const message = handleAuthError(err);
        if (message !== null) setStatus({ kind: 'error', message });
      }
    },
    [handleAuthError],
  );

  return {
    status,
    modal,
    refresh,
    openCreateModal,
    closeCreateModal,
    setCreateName,
    submitCreate,
    revoke,
  };
}
