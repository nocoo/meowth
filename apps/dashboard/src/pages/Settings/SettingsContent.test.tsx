import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsContent from './SettingsContent';

// Pure-props Content tests for Phase 2 Stage C5.

describe('SettingsContent (props, Stage C5)', () => {
  it('ready + reachable renders the success Notice with "Daemon reachable."', () => {
    render(<SettingsContent status={{ kind: 'ready', daemonReachable: true }} />);
    expect(screen.getByText('Daemon reachable.')).toBeInTheDocument();
    // success/warning Notices keep the default polite role="status".
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ready + unreachable renders the warning Notice with polite role="status"', () => {
    render(<SettingsContent status={{ kind: 'ready', daemonReachable: false }} />);
    expect(screen.getByText('Daemon unreachable.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('error status renders the destructive Notice with role="alert" + message', () => {
    render(<SettingsContent status={{ kind: 'error', message: 'auth-failure' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('auth-failure');
  });

  it('always renders the read-only daemon-config explanatory note', () => {
    render(<SettingsContent status={{ kind: 'ready', daemonReachable: true }} />);
    expect(
      screen.getByText(/Daemon configuration .* is not exposed in this page/),
    ).toBeInTheDocument();
    expect(screen.getByText('~/.meowth/config.toml')).toBeInTheDocument();
  });
});
