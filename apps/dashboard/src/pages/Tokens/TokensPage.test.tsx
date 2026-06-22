import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokensPage from './TokensPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('TokensPage', () => {
  it('renders the heading and the empty placeholder', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tokens: [] }), { status: 200 }),
    );
    const router = createMemoryRouter([{ path: '*', element: <TokensPage /> }], {
      initialEntries: ['/tokens'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tokens' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No tokens yet.')).toBeInTheDocument());
  });

  it('opens and closes the create-token dialog', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tokens: [] }), { status: 200 }),
    );
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: '*', element: <TokensPage /> }], {
      initialEntries: ['/tokens'],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText('No tokens yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Create token/i }));
    expect(screen.getByRole('dialog', { name: /Create token/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
