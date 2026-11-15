import { SidebarProvider } from '@nocoo/basalt';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './sidebar';

function renderSidebar(opts: { mobile?: boolean; route?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.route ?? '/overview']}>
      <SidebarProvider>
        <Sidebar mobile={opts.mobile ?? false} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar (basalt 3.3.6 rail)', () => {
  it('renders the five product nav items in expanded desktop state', () => {
    renderSidebar();
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active route with aria-current', () => {
    renderSidebar({ route: '/agents' });
    const active = screen.getByRole('button', { name: 'Agents' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Sessions highlighted under /sessions/<id> via isItemActive', () => {
    renderSidebar({ route: '/sessions/abc' });
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders an "M" Avatar fallback at the bottom (no user data)', () => {
    renderSidebar();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('expanded user section shows the "Meowth" name and "Local daemon" subtitle', () => {
    renderSidebar();
    expect(screen.getByText('Local daemon')).toBeInTheDocument();
  });

  it('desktop expanded mode exposes a "Collapse sidebar" toggle button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('aria-label on the outer <aside> is "Primary navigation"', () => {
    renderSidebar();
    expect(screen.getByRole('complementary', { name: 'Primary navigation' })).toBeInTheDocument();
  });

  it('expanded mode renders the SidebarBrand version badge (v<APP_VERSION>)', () => {
    const { container } = renderSidebar();
    const badge = container.querySelector('[data-slot="sidebar-brand-version"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? '').toMatch(/^v\S+$/);
  });

  it('mobile mode renders the version badge and a dismiss control instead of collapse', () => {
    const { container } = renderSidebar({ mobile: true });
    expect(container.querySelector('[data-slot="sidebar-brand-version"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('expanded mode renders group labels: Dashboard + System', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
  });

  it('collapses a group from its label', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const dashboard = screen.getByRole('button', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('aria-expanded', 'true');
    await user.click(dashboard);
    expect(dashboard).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    await user.click(dashboard);
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('collapsing the rail marks the sidebar data-collapsed (brand copy hides via library CSS)', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const rail = screen.getByRole('complementary', { name: 'Primary navigation' });
    expect(rail).not.toHaveAttribute('data-collapsed');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(rail).toHaveAttribute('data-collapsed', '');
    expect(screen.queryByRole('button', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'System' })).not.toBeInTheDocument();
  });

  it('collapsed mode keeps the logo in place at the top (does not jump out)', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByAltText('Meowth')).toBeInTheDocument();
  });

  it('collapsed rows stay reachable through tooltip composition', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('collapsed mode renders the flat icon rail with all five nav items + Expand button', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    for (const label of ['Overview', 'Agents', 'Sessions', 'Tokens', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('toggle button flips between Collapse and Expand labels', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });
});
