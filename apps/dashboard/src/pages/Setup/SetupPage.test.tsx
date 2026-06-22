import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupPage from './SetupPage';

// We let the page hit the real useSetupViewModel; it then issues
// real fetch calls through models/api, which we mock. This keeps
// the test honest to the page→viewmodel→model→api seam.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderAt(path = '/setup') {
  const router = createMemoryRouter(
    [
      { path: '/setup', element: <SetupPage /> },
      { path: '/overview', element: <div>overview content</div> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('SetupPage', () => {
  it('renders mode A (token paste) by default with a Continue button', () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: /Meowth - Setup/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /setup-code instead/i })).toBeInTheDocument();
  });

  it('switches to mint mode when the link button is clicked', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('button', { name: /setup-code instead/i }));
    expect(screen.getByRole('button', { name: /Mint token/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to/i })).toBeInTheDocument();
  });

  it('surfaces an inline error and stays on the setup page for an invalid token shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderAt();
    await user.type(screen.getByPlaceholderText('mwt_...'), 'mwt_short');
    await user.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Meowth token/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('overview content')).not.toBeInTheDocument();
  });
});
