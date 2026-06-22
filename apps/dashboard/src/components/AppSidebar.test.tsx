import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppSidebar from './AppSidebar';

// docs/architecture/06 §4.1.2 / §6: meowth-local AppSidebar
// exposes 5 product nav items + Setup. Active state derives from
// useLocation; /sessions/:id stays under Sessions.

beforeEachEnsureMatchMedia();

function beforeEachEnsureMatchMedia(): void {
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
}

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '*', element: <AppSidebar /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

describe('AppSidebar', () => {
  it('renders all 5 product navigation items plus Setup', () => {
    renderAt('/overview');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toBeInTheDocument();
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings', 'Setup']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('marks the active item with aria-current=page', () => {
    renderAt('/agents');
    const agents = screen.getByRole('link', { name: /Agents/ });
    expect(agents).toHaveAttribute('aria-current', 'page');
    const overview = screen.getByRole('link', { name: /Overview/ });
    expect(overview).not.toHaveAttribute('aria-current');
  });

  it('keeps Sessions active when on a session detail route', () => {
    renderAt('/sessions/019ee83f-661f-715f-b186-2db67a23b559');
    const sessions = screen.getByRole('link', { name: /Sessions/ });
    expect(sessions).toHaveAttribute('aria-current', 'page');
  });

  it('Setup link is active on /setup', () => {
    renderAt('/setup');
    const setup = screen.getByRole('link', { name: /Setup/ });
    expect(setup).toBeInTheDocument();
  });
});
