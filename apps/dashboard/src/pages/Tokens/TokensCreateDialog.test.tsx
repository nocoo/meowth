import type { TokensViewModel } from '@/viewmodels/useTokensViewModel';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokensCreateDialog from './TokensCreateDialog';

// TokensCreateDialog tests for Phase 2 Stage C4.
//
// Boundary coverage for the extracted dialog:
//   - dialog role / name when modal.open
//   - per-phase rendering (idle / submitting / error / reveal)
//   - Cancel and Done both call closeCreateModal
//   - submit disabled during `submitting`
//   - reveal phase mounts SecretReveal (masked by default)
//   - plaintext-lifecycle: secret never appears in DOM textContent
//     when masked, secret disappears entirely after closeCreateModal
//     reduces modal to { open: false }, and a fresh `idle` modal
//     does not surface plaintext.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vmFor(overrides: Partial<TokensViewModel>): TokensViewModel {
  return {
    status: { kind: 'ready', tokens: [] },
    modal: { open: false },
    refresh: () => {
      /* noop */
    },
    openCreateModal: () => {
      /* noop */
    },
    closeCreateModal: () => {
      /* noop */
    },
    setCreateName: () => {
      /* noop */
    },
    submitCreate: async () => {
      /* noop */
    },
    revoke: async () => {
      /* noop */
    },
    ...overrides,
  };
}

describe('TokensCreateDialog (Stage C4)', () => {
  it('renders nothing when modal.open is false', () => {
    const { container } = render(<TokensCreateDialog vm={vmFor({})} />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes role=dialog with name="Create token" when modal.open', () => {
    render(<TokensCreateDialog vm={vmFor({ modal: { open: true, phase: 'idle', name: '' } })} />);
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
  });

  it('phase=idle renders the name input + Create button; Cancel calls closeCreateModal', async () => {
    const closeCreateModal = vi.fn();
    render(
      <TokensCreateDialog
        vm={vmFor({
          modal: { open: true, phase: 'idle', name: 'ci-bot' },
          closeCreateModal,
        })}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('ci-bot');
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeCreateModal).toHaveBeenCalledTimes(1);
  });

  it('phase=submitting disables the submit button and shows "Creating..."', () => {
    render(
      <TokensCreateDialog
        vm={vmFor({ modal: { open: true, phase: 'submitting', name: 'ci-bot' } })}
      />,
    );
    const submit = screen.getByRole('button', { name: 'Creating...' });
    expect(submit).toBeDisabled();
  });

  it('phase=error renders role=alert with the vm message and keeps the name input', () => {
    render(
      <TokensCreateDialog
        vm={vmFor({
          modal: { open: true, phase: 'error', name: 'bad-name', message: 'Name is required.' },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');
    expect(screen.getByLabelText('Name')).toHaveValue('bad-name');
  });

  it('phase=reveal mounts SecretReveal masked; Done calls closeCreateModal', async () => {
    const closeCreateModal = vi.fn();
    const SECRET = 'mwt_SUPERSECRET_PLAINTEXT';
    render(
      <TokensCreateDialog
        vm={vmFor({
          modal: {
            open: true,
            phase: 'reveal',
            createdName: 'ci-bot',
            createdSecret: SECRET,
          },
          closeCreateModal,
        })}
      />,
    );
    expect(screen.getByText('Token created')).toBeInTheDocument();
    // SecretReveal starts masked: plaintext must NOT be in DOM textContent.
    expect(document.body.textContent).not.toContain(SECRET);
    // The mask is exposed via the secret-reveal-value output.
    expect(screen.getByTestId('secret-reveal-value')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Done' }));
    expect(closeCreateModal).toHaveBeenCalledTimes(1);
  });

  it('plaintext lifecycle: secret leaves the DOM after close, and a fresh idle modal does not leak it', () => {
    const SECRET = 'mwt_LIFECYCLE_PLAINTEXT';
    const { rerender, container } = render(
      <TokensCreateDialog
        vm={vmFor({
          modal: {
            open: true,
            phase: 'reveal',
            createdName: 'ci-bot',
            createdSecret: SECRET,
          },
        })}
      />,
    );
    // While reveal is open, the secret is in the underlying state
    // but masked in the DOM; it must not appear as text content.
    expect(document.body.textContent).not.toContain(SECRET);

    // Close (vm reduces modal to { open: false }) → dialog unmounts.
    rerender(<TokensCreateDialog vm={vmFor({ modal: { open: false } })} />);
    expect(container.firstChild).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);

    // Re-open with a fresh idle modal (the canonical openCreateModal
    // state). The previous plaintext must be gone.
    rerender(<TokensCreateDialog vm={vmFor({ modal: { open: true, phase: 'idle', name: '' } })} />);
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.queryByText('Token created')).toBeNull();
  });
});
