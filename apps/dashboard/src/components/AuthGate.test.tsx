import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthGate from './AuthGate';

const TOKEN_KEY = 'meowth_token';

function ProtectedChild() {
  return <div data-testid="protected">PROTECTED CONTENT</div>;
}

function SetupSentinel() {
  const loc = useLocation();
  return <div data-testid="setup-sentinel">setup at {loc.pathname}</div>;
}

function harness() {
  return (
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route
          path="/"
          element={
            <AuthGate>
              <ProtectedChild />
            </AuthGate>
          }
        >
          <Route path="overview" element={<ProtectedChild />} />
        </Route>
        <Route path="/setup" element={<SetupSentinel />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('AuthGate', () => {
  it('redirects to /setup when no token is stored', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(harness());
    await waitFor(() => expect(screen.getByTestId('setup-sentinel')).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders children after a successful /v1/agents probe', async () => {
    window.localStorage.setItem(TOKEN_KEY, `mwt_${'A'.repeat(39)}`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ agents: [] }), { status: 200 }),
    );
    render(harness());
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
  });

  it('clears stored token and redirects to /setup on 401', async () => {
    window.localStorage.setItem(TOKEN_KEY, `mwt_${'B'.repeat(39)}`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401 }),
        { status: 401 },
      ),
    );
    render(harness());
    await waitFor(() => expect(screen.getByTestId('setup-sentinel')).toBeInTheDocument());
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('shows DaemonUnreachable on network rejection, keeps token, and Retry re-probes', async () => {
    window.localStorage.setItem(TOKEN_KEY, `mwt_${'C'.repeat(39)}`);
    let attempt = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    });
    const user = userEvent.setup();
    render(harness());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Daemon unreachable' })).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(TOKEN_KEY)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
    expect(attempt).toBeGreaterThanOrEqual(2);
  });

  it('does not render protected children while the probe is in flight', async () => {
    window.localStorage.setItem(TOKEN_KEY, `mwt_${'D'.repeat(39)}`);
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(harness());
    // While the probe is in flight, protected content must not show.
    expect(screen.queryByTestId('protected')).toBeNull();
    resolveFetch?.(new Response(JSON.stringify({ agents: [] }), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument());
  });
});
