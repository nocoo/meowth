import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('SettingsPage', () => {
  it('renders Daemon reachable when healthz succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const router = createMemoryRouter([{ path: '*', element: <SettingsPage /> }], {
      initialEntries: ['/settings'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Daemon reachable.')).toBeInTheDocument());
  });

  it('renders Daemon unreachable when healthz fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const router = createMemoryRouter([{ path: '*', element: <SettingsPage /> }], {
      initialEntries: ['/settings'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText('Daemon unreachable.')).toBeInTheDocument());
  });
});
