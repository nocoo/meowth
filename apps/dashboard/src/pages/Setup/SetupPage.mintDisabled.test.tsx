import type { SetupViewModel } from '@/viewmodels/useSetupViewModel';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupPage from './SetupPage';

// Phase 2 Stage C6 — isolated coverage for the mint-disabled
// Notice path. The main SetupPage.test.tsx file deliberately
// drives the real useSetupViewModel through fetch mocks; in
// jsdom the page origin satisfies the loopback gate, so mode B
// + mintDisabled never naturally exercises here. We mock the
// viewmodel locally for this one branch only.

const { mockUseSetup } = vi.hoisted(() => ({ mockUseSetup: vi.fn() }));

vi.mock('@/viewmodels/useSetupViewModel', () => ({
  default: () => mockUseSetup() as SetupViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseSetup.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('SetupPage mint-disabled Notice (Stage C6)', () => {
  it('renders the disabled reason as a polite Notice and keeps the Mint button disabled', () => {
    const REASON = 'Mint must be reached at http://127.0.0.1:7040/setup (test-injected).';
    mockUseSetup.mockReturnValue({
      mode: 'mint',
      status: { kind: 'idle' },
      mintDisabled: true,
      mintDisabledReason: REASON,
      setMode: () => {
        /* noop */
      },
      submitToken: async () => {
        /* noop */
      },
      submitMint: async () => {
        /* noop */
      },
    });
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <SetupPage />
      </MemoryRouter>,
    );
    const notice = screen.getByText(REASON);
    expect(notice).toHaveAttribute('data-slot', 'notice');
    // Polite default — not an alert.
    expect(notice).toHaveAttribute('role', 'status');
    // The Mint button stays disabled while mintDisabled is true.
    const mintButton = screen.getByRole('button', { name: /Mint token/ });
    expect(mintButton).toBeDisabled();
  });
});
