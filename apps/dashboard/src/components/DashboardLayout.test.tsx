import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './DashboardLayout';

beforeEach(() => {
  if (typeof window.matchMedia === 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }
});

afterEach(() => {
  cleanup();
});

describe('DashboardLayout', () => {
  it('renders the Meowth brand header, sidebar, and the routed outlet', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <DashboardLayout />,
          children: [{ path: 'overview', element: <div>overview content</div> }],
        },
      ],
      { initialEntries: ['/overview'] },
    );
    render(<RouterProvider router={router} />);

    // Brand header text (no logo per 01 §6 / 06 §4.1.2).
    expect(screen.getByRole('heading', { level: 1, name: 'Meowth' })).toBeInTheDocument();

    // Sidebar landmark with 5 nav items.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }

    // Theme toggle button (rendered in the header).
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();

    // Outlet content from the child route renders inside <main>.
    expect(screen.getByText('overview content')).toBeInTheDocument();
  });
});
