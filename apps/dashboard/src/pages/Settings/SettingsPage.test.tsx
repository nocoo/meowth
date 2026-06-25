import type { SettingsViewModel } from '@/viewmodels/useSettingsViewModel';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

// Page shell tests for Phase 2 Stage C5. Mocks
// `useSettingsViewModel` directly so the test does not depend on
// healthz fetch ordering. Content/Notice branches are covered by
// SettingsContent.test.tsx.

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));

vi.mock('@/viewmodels/useSettingsViewModel', () => ({
  default: () => mockUseSettings() as SettingsViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseSettings.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vmFor(overrides: Partial<SettingsViewModel>): SettingsViewModel {
  return {
    status: { kind: 'loading' },
    version: '0.0.0-test',
    refresh: () => {
      /* noop */
    },
    ...overrides,
  };
}

describe('SettingsPage (shell, Stage C5)', () => {
  it('always renders the Settings heading and the Dashboard build row', () => {
    mockUseSettings.mockReturnValue(vmFor({ status: { kind: 'loading' }, version: '1.2.3' }));
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard build')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
  });

  it('loading branch renders SettingsSkeleton and no Notice yet', () => {
    mockUseSettings.mockReturnValue(vmFor({ status: { kind: 'loading' }, version: '1.2.3' }));
    const { container } = render(<SettingsPage />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Daemon reachable.')).toBeNull();
    expect(screen.queryByText('Daemon unreachable.')).toBeNull();
    // Build row stays visible even while healthz is still loading.
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
  });

  it('ready + reachable renders the success Notice with "Daemon reachable."', () => {
    mockUseSettings.mockReturnValue(
      vmFor({ status: { kind: 'ready', daemonReachable: true }, version: '1.2.3' }),
    );
    render(<SettingsPage />);
    expect(screen.getByText('Daemon reachable.')).toBeInTheDocument();
  });

  it('ready + unreachable renders the warning Notice with "Daemon unreachable."', () => {
    mockUseSettings.mockReturnValue(
      vmFor({ status: { kind: 'ready', daemonReachable: false }, version: '1.2.3' }),
    );
    render(<SettingsPage />);
    expect(screen.getByText('Daemon unreachable.')).toBeInTheDocument();
  });

  it('typed error status renders a destructive Notice with role="alert" and the vm message', () => {
    mockUseSettings.mockReturnValue(
      vmFor({ status: { kind: 'error', message: 'settings-boom' }, version: '1.2.3' }),
    );
    render(<SettingsPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('settings-boom');
  });
});
