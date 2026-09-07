import type { TokenView } from '@/viewmodels/useTokensViewModel';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TokensContent from './TokensContent';

// Pure-props Content tests for Phase 2 Stage C4.

async function noopRevoke(): Promise<void> {
  /* noop */
}

function makeToken(overrides: Partial<TokenView> = {}): TokenView {
  return {
    id: 't-1',
    name: 'ci-bot',
    prefix: 'mwt_ABCDE',
    created_at: '2026-06-01T00:00:00Z',
    created_via: 'dashboard',
    last_used_at: null,
    ...overrides,
  };
}

describe('TokensContent (props, Stage C4)', () => {
  it('renders the 5-column header when tokens are present', () => {
    render(<TokensContent tokens={[makeToken()]} onRevoke={noopRevoke} />);
    for (const label of ['Name', 'Prefix', 'Created', 'Last used']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('renders one row per token with name/prefix/created/last_used cells', () => {
    render(
      <TokensContent
        tokens={[
          makeToken({ id: 't-1', name: 'ci-bot', prefix: 'mwt_ABCDE' }),
          makeToken({
            id: 't-2',
            name: 'laptop',
            prefix: 'mwt_FGHIJ',
            last_used_at: '2026-06-02T00:00:00Z',
          }),
        ]}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByRole('cell', { name: 'ci-bot' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mwt_ABCDE' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'laptop' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mwt_FGHIJ' })).toBeInTheDocument();
    // last_used_at null → em-dash placeholder.
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('Revoke button calls onRevoke(tok.id) after confirm', async () => {
    const onRevoke = vi.fn(noopRevoke);
    render(<TokensContent tokens={[makeToken({ id: 'target-id' })]} onRevoke={onRevoke} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRevoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRevoke).toHaveBeenCalledWith('target-id');
  });

  it('does not fire onRevoke twice while the first confirm is in flight', async () => {
    let release: (() => void) | undefined;
    const onRevoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<TokensContent tokens={[makeToken({ id: 'target-id' })]} onRevoke={onRevoke} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.querySelector('button[aria-busy="true"]')).not.toBeNull();
    expect(onRevoke).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('shows an EmptyState (not the table) when tokens list is empty', () => {
    render(<TokensContent tokens={[]} onRevoke={noopRevoke} />);
    expect(screen.getByText('No tokens yet')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('wraps the populated table in a rounded-basalt-card bg-basalt-secondary L2 surface', () => {
    const { container } = render(<TokensContent tokens={[makeToken()]} onRevoke={noopRevoke} />);
    const wrap = container.querySelector('[data-basalt-surface]');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-slot="table-container"]')).not.toBeNull();
  });
});
