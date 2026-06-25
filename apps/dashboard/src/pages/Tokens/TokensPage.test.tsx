import type { TokensViewModel } from '@/viewmodels/useTokensViewModel';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokensPage from './TokensPage';

// Page shell tests for Phase 2 Stage C4. Mocks
// `useTokensViewModel` directly so the test does not depend on
// fetch ordering. Content/Dialog rendering is covered by their
// own test files.

const { mockUseTokens } = vi.hoisted(() => ({ mockUseTokens: vi.fn() }));

vi.mock('@/viewmodels/useTokensViewModel', () => ({
  default: () => mockUseTokens() as TokensViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseTokens.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vmFor(overrides: Partial<TokensViewModel>): TokensViewModel {
  return {
    status: { kind: 'loading' },
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

describe('TokensPage (shell, Stage C4)', () => {
  it('always renders the Tokens heading and the Create token button', () => {
    mockUseTokens.mockReturnValue(vmFor({ status: { kind: 'loading' } }));
    render(<TokensPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tokens' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create token' })).toBeInTheDocument();
  });

  it('Create token button calls vm.openCreateModal', async () => {
    const openCreateModal = vi.fn();
    mockUseTokens.mockReturnValue(vmFor({ status: { kind: 'loading' }, openCreateModal }));
    const user = userEvent.setup();
    render(<TokensPage />);
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(openCreateModal).toHaveBeenCalledTimes(1);
  });

  it('loading branch renders the TokensSkeleton (5 row × 5 col placeholders)', () => {
    mockUseTokens.mockReturnValue(vmFor({ status: { kind: 'loading' } }));
    const { container } = render(<TokensPage />);
    expect(container.querySelectorAll('.animate-pulse').length).toBe(5 * 5);
  });

  it('error branch routes to EmptyState (tone="error") with the vm message', () => {
    mockUseTokens.mockReturnValue(vmFor({ status: { kind: 'error', message: 'tokens-boom' } }));
    render(<TokensPage />);
    expect(screen.getByText('Tokens unavailable')).toBeInTheDocument();
    expect(screen.getByText('tokens-boom')).toBeInTheDocument();
  });

  it('ready branch hands the tokens list to TokensContent', () => {
    mockUseTokens.mockReturnValue(
      vmFor({
        status: {
          kind: 'ready',
          tokens: [
            {
              id: 't-1',
              name: 'ci-bot',
              prefix: 'mwt_ABCDE',
              created_at: '2026-06-01T00:00:00Z',
              created_via: 'dashboard',
              last_used_at: null,
            },
          ],
        },
      }),
    );
    render(<TokensPage />);
    expect(screen.getByRole('cell', { name: 'ci-bot' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mwt_ABCDE' })).toBeInTheDocument();
  });

  it('renders the create dialog only when vm.modal.open is true', () => {
    mockUseTokens.mockReturnValue(
      vmFor({ status: { kind: 'ready', tokens: [] }, modal: { open: false } }),
    );
    const { rerender } = render(<TokensPage />);
    expect(screen.queryByRole('dialog')).toBeNull();

    mockUseTokens.mockReturnValue(
      vmFor({
        status: { kind: 'ready', tokens: [] },
        modal: { open: true, phase: 'idle', name: '' },
      }),
    );
    rerender(<TokensPage />);
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
  });

  it('plaintext boundary: secret is visible only inside the reveal dialog, never in table cells, and leaves the DOM after close', async () => {
    const SECRET = 'mwt_PAGE_BOUNDARY_PLAINTEXT';
    const READY_TOKEN = {
      id: 't-1',
      name: 'ci-bot',
      prefix: 'mwt_ABCDE',
      created_at: '2026-06-01T00:00:00Z',
      created_via: 'dashboard' as const,
      last_used_at: null,
    };

    // Phase 1 — reveal dialog open alongside a ready token list.
    // SecretReveal starts masked: the table renders and the
    // plaintext must not appear anywhere in the rendered DOM.
    mockUseTokens.mockReturnValue(
      vmFor({
        status: { kind: 'ready', tokens: [READY_TOKEN] },
        modal: {
          open: true,
          phase: 'reveal',
          createdName: 'ci-bot',
          createdSecret: SECRET,
        },
      }),
    );
    const { rerender } = render(<TokensPage />);
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'ci-bot' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mwt_ABCDE' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);

    // No table cell (including the prefix cell) carries the
    // plaintext secret while the reveal dialog is open.
    for (const cell of screen.getAllByRole('cell')) {
      expect(cell.textContent ?? '').not.toContain(SECRET);
    }

    // Phase 2 — user reveals the plaintext. It now appears
    // inside the SecretReveal output, but must still be absent
    // from every table cell.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe(SECRET);
    expect(screen.getByRole('cell', { name: 'ci-bot' })).toBeInTheDocument();
    for (const cell of screen.getAllByRole('cell')) {
      expect(cell.textContent ?? '').not.toContain(SECRET);
    }

    // Phase 3 — close the dialog (vm reduces modal to
    // { open: false }). Dialog unmounts; plaintext leaves DOM.
    mockUseTokens.mockReturnValue(
      vmFor({ status: { kind: 'ready', tokens: [READY_TOKEN] }, modal: { open: false } }),
    );
    rerender(<TokensPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);

    // Phase 4 — reopen a fresh idle modal. The previously
    // revealed plaintext must not reappear.
    mockUseTokens.mockReturnValue(
      vmFor({
        status: { kind: 'ready', tokens: [READY_TOKEN] },
        modal: { open: true, phase: 'idle', name: '' },
      }),
    );
    rerender(<TokensPage />);
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.queryByText('Token created')).toBeNull();
  });
});
