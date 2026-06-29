import { AppShell } from '@/components/layout/app-shell';
import type { OverviewViewModel } from '@/viewmodels/useOverviewViewModel';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// Integration smoke for the AppShell ↔ Page refresh contract:
// when a Page mounts and calls `useRegisterRefresh(vm.refresh)`,
// the header's RefreshButton must appear and clicking it must
// invoke the Page's refresh handler. Per-Page L1 tests only
// cover the Page in isolation; this test pins the wiring
// between RefreshProvider (mounted by AppShell) and the Page.

const { mockUseOverview } = vi.hoisted(() => ({ mockUseOverview: vi.fn() }));

vi.mock('@/viewmodels/useOverviewViewModel', () => ({
  default: () => mockUseOverview() as OverviewViewModel,
}));

// Import after vi.mock so the mocked viewmodel is in place.
import OverviewPage from '@/pages/Overview/OverviewPage';

function vm(refresh: () => void | Promise<void>): OverviewViewModel {
  return {
    status: {
      kind: 'ready',
      data: { health: { ok: true }, tokens: [], sessions: [], agents: [] },
    },
    refresh,
  };
}

function renderShellWithOverview() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/overview" element={<OverviewPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell ↔ Page refresh wiring (Overview as a representative)', () => {
  it('refresh button is visible once a page registers a handler', () => {
    const refresh = vi.fn();
    mockUseOverview.mockReturnValue(vm(refresh));
    renderShellWithOverview();
    expect(screen.getByRole('button', { name: /refresh page data/i })).toBeInTheDocument();
  });

  it("clicking the header refresh button invokes the page's vm.refresh", async () => {
    const refresh = vi.fn();
    mockUseOverview.mockReturnValue(vm(refresh));
    renderShellWithOverview();
    await userEvent.click(screen.getByRole('button', { name: /refresh page data/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
