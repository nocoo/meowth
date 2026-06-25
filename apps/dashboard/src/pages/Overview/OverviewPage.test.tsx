import type { OverviewViewModel } from '@/viewmodels/useOverviewViewModel';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPage from './OverviewPage';

// Page shell tests for Phase 2 Stage C1. The shell owns three
// branches (loading / error / ready) over `useOverviewViewModel`;
// we mock the viewmodel directly so the test does not depend on
// the fetch mock sequence (reviewer correction #2 — Page tests
// should not pin a fetch order).

const { mockUseOverview } = vi.hoisted(() => ({ mockUseOverview: vi.fn() }));

vi.mock('@/viewmodels/useOverviewViewModel', () => ({
  default: () => mockUseOverview() as OverviewViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseOverview.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vm(status: OverviewViewModel['status']): OverviewViewModel {
  return {
    status,
    refresh: () => {
      /* noop */
    },
  };
}

describe('OverviewPage (shell, Stage C1)', () => {
  it('always renders the Overview heading', () => {
    mockUseOverview.mockReturnValue(vm({ kind: 'loading' }));
    render(<OverviewPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeInTheDocument();
  });

  it('loading branch shows the OverviewSkeleton placeholders', () => {
    mockUseOverview.mockReturnValue(vm({ kind: 'loading' }));
    const { container } = render(<OverviewPage />);
    // 4 skeleton tiles × 2 Skeleton spans each = 8 animate-pulse nodes
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(8);
    expect(screen.queryByText('Reachable')).not.toBeInTheDocument();
  });

  it('error branch routes to the EmptyState (tone="error") with the vm message', () => {
    mockUseOverview.mockReturnValue(vm({ kind: 'error', message: 'boom-from-vm' }));
    render(<OverviewPage />);
    expect(screen.getByText('Overview unavailable')).toBeInTheDocument();
    expect(screen.getByText('boom-from-vm')).toBeInTheDocument();
  });

  it('ready branch hands resolved data to OverviewContent', () => {
    mockUseOverview.mockReturnValue(
      vm({
        kind: 'ready',
        data: {
          health: { ok: true },
          tokens: [
            { id: 't', name: 'n', prefix: 'mwt_AAAAA', created_at: 'x', created_via: 'init' },
          ],
          sessions: [],
          agents: [{ type: 'claude', installed: true, executable: '/x', version: 'v1' }],
        },
      }),
    );
    render(<OverviewPage />);
    expect(screen.getByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
  });
});
