import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from './app-shell';

// Stage B1 — AppShell tests. The mobile Sheet a11y contract (route
// change closes drawer, body scroll unlock, aria title/description,
// escape/overlay close, focus return) is exercised here. Desktop
// (non-mobile) tests cover the static floating-island + breadcrumb
// shape.

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  // matchMedia returns the shim that always reports matches=false;
  // useIsMobile re-derives from window.innerWidth via getSnapshot,
  // and React 19 + useSyncExternalStore picks the new value when
  // we fire a resize.
  window.dispatchEvent(new Event('resize'));
}

function ShellWithChildPage({ child }: { child: React.ReactElement }) {
  return (
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/overview" element={child} />
          <Route path="/agents" element={<div data-testid="agents-page">agents</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  setViewport(1280);
});

afterEach(() => {
  setViewport(ORIGINAL_INNER_WIDTH);
  document.body.style.overflow = '';
});

describe('AppShell (Stage B1) — desktop layout', () => {
  it('renders the floating island wrapper around the route Outlet', () => {
    const { container } = render(<ShellWithChildPage child={<div>page-body</div>} />);
    expect(screen.getByText('page-body')).toBeInTheDocument();
    // The L1 floating-island wrapper carries rounded-island + bg-card.
    expect(container.querySelector('.rounded-island.bg-card')).toBeTruthy();
  });

  it('header is h-14 and has no border-b (L0 same color as page)', () => {
    const { container } = render(<ShellWithChildPage child={<div>x</div>} />);
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header?.className).toContain('h-14');
    expect(header?.className).not.toMatch(/border-b/);
  });

  it('breadcrumbs include "Meowth" home crumb plus active page', () => {
    render(<ShellWithChildPage child={<div>overview-body</div>} />);
    expect(screen.getByRole('link', { name: 'Meowth' })).toBeInTheDocument();
    // Sidebar nav also renders "Overview" as a link; the breadcrumb
    // version is the unique aria-current=page span.
    const matches = screen.getAllByText('Overview');
    const breadcrumb = matches.find((el) => el.getAttribute('aria-current') === 'page');
    expect(breadcrumb).toBeDefined();
  });

  it('desktop mode does not render the mobile menu trigger', () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
  });
});

describe('AppShell (Stage B1) — mobile Sheet a11y', () => {
  beforeEach(() => {
    setViewport(420);
  });

  it('opens the Sheet drawer when the menu trigger fires', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('exposes the required Navigation / "Browse Meowth pages" aria labels', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // SheetTitle / SheetDescription are sr-only but still in the DOM.
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Browse Meowth pages')).toBeInTheDocument();
  });

  it('escape key closes the drawer', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('locks body scroll while open and unlocks on close', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    expect(document.body.style.overflow).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden');
    });
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });

  it('closes the drawer on route change', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Click an inner sidebar NavLink to trigger a route change; the
    // AppShell's `useLocation` effect should then call
    // `setMobileOpen(false)`. The mobile drawer renders the Sidebar
    // with `mobile=true`, so its 5 nav items are inside the dialog.
    const agentsLink = screen
      .getAllByRole('link', { name: 'Agents' })
      .find((el) => el.getAttribute('href') === '/agents');
    expect(agentsLink).toBeDefined();
    if (!agentsLink) throw new Error('agents link not found');
    await userEvent.click(agentsLink);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('overlay click closes the drawer and unlocks body scroll', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Radix Dialog renders an overlay sibling on the dialog with
    // data-slot="sheet-overlay"; clicking it (pointerDown +
    // pointerUp) triggers the same close path as Escape.
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).toBeTruthy();
    if (!overlay) throw new Error('sheet overlay not found');
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });

  it('returns focus to the menu trigger when the drawer closes', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // AppShell pins the toggle ref and drives `onCloseAutoFocus`
    // explicitly because the trigger lives outside the Sheet
    // subtree (Radix's default trigger-return cannot find it).
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
