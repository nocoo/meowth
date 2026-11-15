import { TooltipProvider } from '@nocoo/basalt';
import { ThemeProvider } from '@nocoo/basalt/providers/theme';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme-init';
import { AppShell } from './app-shell';

// AppShell tests against the basalt 3.3.6 shell contract: SidebarDrawer
// mobile navigation (route-change close, a11y title/description,
// escape/overlay close, focus return) and the desktop floating-island +
// breadcrumb shape.

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
    <TooltipProvider>
      <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
        <MemoryRouter initialEntries={['/overview']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/overview" element={child} />
              <Route path="/agents" element={<div data-testid="agents-page">agents</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  setViewport(1280);
});

afterEach(() => {
  setViewport(ORIGINAL_INNER_WIDTH);
  document.body.style.overflow = '';
});

describe('AppShell — desktop layout', () => {
  it('renders the floating island wrapper around the route Outlet', () => {
    const { container } = render(<ShellWithChildPage child={<div>page-body</div>} />);
    expect(screen.getByText('page-body')).toBeInTheDocument();
    // Basalt owns the island surface; the route remains inside that root.
    const island = container.querySelector('[data-basalt-surface-root]');
    expect(island).toBeTruthy();
    expect(island?.className ?? '').toContain('w-full');
  });

  it('header is h-14 and has no border-b (L0 same color as page)', () => {
    const { container } = render(<ShellWithChildPage child={<div>x</div>} />);
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header?.className).toContain('h-basalt-14');
    expect(header?.className).not.toMatch(/border-b/);
  });

  it('breadcrumbs include "Meowth" home crumb plus active page', () => {
    render(<ShellWithChildPage child={<div>overview-body</div>} />);
    expect(screen.getByRole('link', { name: 'Meowth' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('desktop mode does not render the mobile menu trigger', () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
  });

  it('header right exposes the GitHub repo link (target=_blank, secure rel, decorative svg)', () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    // ProjectLinks appends the new-tab suffix to the accessible name.
    const link = screen.getByRole('link', { name: /GitHub repository/ });
    expect(link.getAttribute('href')).toBe('https://github.com/nocoo/meowth');
    expect(link.getAttribute('target')).toBe('_blank');
    // rel must include both noopener and noreferrer so the new
    // context cannot reach window.opener.
    const rel = link.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    // The glyph is decorative — aria-hidden=true; the library owns its size.
    const svg = link.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('header right also renders the hexly.ai project link', () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    const link = screen.getByRole('link', { name: /Meowth on hexly\.ai/ });
    expect(link.getAttribute('href')).toBe('https://hexly.ai/projects/meowth');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('header right renders the ThemeToggle control', () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    // Basalt ThemeToggle names the theme the next click switches to; in
    // the default system state that is the light theme.
    expect(
      screen.getByRole('button', { name: /Switch to (dark|light) theme/ }),
    ).toBeInTheDocument();
  });

  it('chat route switches the island into the full-height composer layout', () => {
    const { container } = render(
      <TooltipProvider>
        <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/chat" element={<div>chat-body</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </TooltipProvider>,
    );
    expect(screen.getByText('chat-body')).toBeInTheDocument();
    const island = container.querySelector('[data-basalt-surface-root]');
    expect(island?.className ?? '').toContain('flex');
    expect(island?.className ?? '').toContain('overflow-hidden');
  });

  it('unmatched routes render the shell without a page title', () => {
    render(
      <TooltipProvider>
        <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
          <MemoryRouter initialEntries={['/nowhere']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="*" element={<div>unknown-body</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </TooltipProvider>,
    );
    expect(screen.getByText('unknown-body')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('AppShell — mobile SidebarDrawer a11y', () => {
  beforeEach(() => {
    setViewport(420);
  });

  it('opens the drawer when the menu trigger fires', async () => {
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
    // SidebarDrawer renders the sr-only title/description.
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Browse Meowth pages')).toBeInTheDocument();
  });

  it('menu trigger wires aria-controls to the drawer content id', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(trigger.getAttribute('aria-controls')).toBeTruthy();
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toBeTruthy();
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

  it('closes the drawer on route change', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Activate a sidebar row to trigger a route change; the AppShell's
    // `useLocation` effect should then call `setMobileOpen(false)`. The
    // drawer renders the Sidebar with `mobile`, so its 5 nav items are
    // inside the dialog.
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agents' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('overlay click closes the drawer', async () => {
    render(<ShellWithChildPage child={<div>x</div>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const overlay = document.querySelector('.basalt-sheet-overlay');
    expect(overlay).toBeTruthy();
    if (!overlay) throw new Error('sheet overlay not found');
    // jsdom 30 implements PointerEvent, so Radix registers the pointer
    // sequence itself; userEvent emits the full realistic sequence.
    await userEvent.click(overlay);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    // SidebarDrawer's returnFocusRef restores focus to the AppHeaderMenuButton.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
