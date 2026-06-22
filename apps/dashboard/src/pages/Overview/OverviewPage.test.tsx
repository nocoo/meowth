import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPage from './OverviewPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mockHappy(): void {
  let i = 0;
  const bodies = [
    JSON.stringify({ ok: true }),
    JSON.stringify({
      tokens: [{ id: 't', name: 'n', prefix: 'mwt_AAAAA', created_at: 'x', created_via: 'init' }],
    }),
    JSON.stringify({ sessions: [] }),
    JSON.stringify({
      agents: [{ type: 'claude', installed: true, executable: '/x', version: 'v1' }],
    }),
  ];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const body = bodies[i++ % bodies.length];
    return new Response(body, { status: 200 });
  });
}

describe('OverviewPage', () => {
  it('renders the Overview heading and the loading state initially', () => {
    mockHappy();
    const router = createMemoryRouter([{ path: '*', element: <OverviewPage /> }], {
      initialEntries: ['/overview'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeInTheDocument();
  });

  it('renders the cards once data loads', async () => {
    mockHappy();
    const router = createMemoryRouter([{ path: '*', element: <OverviewPage /> }], {
      initialEntries: ['/overview'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText('Reachable')).toBeInTheDocument());
    expect(screen.getByText('Tokens')).toBeInTheDocument();
  });
});
