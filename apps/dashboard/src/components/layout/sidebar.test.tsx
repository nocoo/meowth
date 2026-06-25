import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './sidebar';
import { SidebarProvider } from './sidebar-context';

function renderSidebar(opts: { mobile?: boolean; route?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.route ?? '/overview']}>
      <SidebarProvider>
        <Sidebar mobile={opts.mobile ?? false} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar (Stage B1)', () => {
  it('renders the five product nav items in expanded desktop state', () => {
    renderSidebar();
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active route via NavLink isActive style', () => {
    renderSidebar({ route: '/agents' });
    const active = screen.getByRole('link', { name: 'Agents' });
    expect(active.className).toContain('bg-accent');
  });

  it('renders an "M" Avatar fallback at the bottom (no user data)', () => {
    renderSidebar();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('mobile mode disables the desktop chrome (no sticky h-screen, no toggle)', () => {
    renderSidebar({ mobile: true });
    // Mobile header omits the collapse/expand button.
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
    // All 5 nav items still render.
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('desktop expanded mode exposes a "Collapse sidebar" toggle button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('aria-label on the outer <aside> is "Primary navigation"', () => {
    renderSidebar();
    expect(screen.getByRole('complementary', { name: 'Primary navigation' })).toBeInTheDocument();
  });

  it('expanded mode renders the version pill (v<APP_VERSION>)', () => {
    renderSidebar();
    const pill = screen.getByTestId('sidebar-version-pill');
    expect(pill).toBeInTheDocument();
    // Pill text is `v<APP_VERSION>`; assert leading `v` + non-empty
    // rest. Exact version is whatever apps/dashboard/package.json
    // declares; pinning a literal here would break on bump.
    expect(pill.textContent ?? '').toMatch(/^v\S+$/);
  });

  it('mobile mode also renders the version pill', () => {
    renderSidebar({ mobile: true });
    expect(screen.getByTestId('sidebar-version-pill')).toBeInTheDocument();
  });

  it('collapsed mode hides the version pill (no header text shown)', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByTestId('sidebar-version-pill')).not.toBeInTheDocument();
  });

  it('collapsed mode renders the Tooltip rail (icon-only) and Expand button', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    // Drive into collapsed state by clicking the header toggle.
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // Expand button visible (no Collapse button in collapsed mode).
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    // Nav still has 5 entries, now as icon-only Tooltip triggers
    // (each NavLink carries aria-label= page name).
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('toggle button flips between Collapse and Expand labels', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });
});
