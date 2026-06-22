import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPage from './AgentsPage';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('AgentsPage', () => {
  it('renders the Agents heading and the loaded table rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          agents: [
            { type: 'claude', installed: true, executable: '/c', version: 'v1' },
            { type: 'codex', installed: false, executable: '', version: '' },
          ],
        }),
        { status: 200 },
      ),
    );
    const router = createMemoryRouter([{ path: '*', element: <AgentsPage /> }], {
      initialEntries: ['/agents'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('claude')).toBeInTheDocument());
    expect(screen.getByText('codex')).toBeInTheDocument();
  });
});
