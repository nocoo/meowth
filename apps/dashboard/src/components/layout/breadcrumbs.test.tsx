import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Breadcrumbs } from './breadcrumbs';

function wrap(items: { label: string; href?: string }[]) {
  return (
    <MemoryRouter>
      <Breadcrumbs items={items} />
    </MemoryRouter>
  );
}

describe('Breadcrumbs (Stage B1)', () => {
  it('uses English aria-label "Breadcrumb" (no Chinese strings)', () => {
    render(wrap([{ label: 'Meowth', href: '/' }]));
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('renders a single non-linked item with aria-current="page"', () => {
    render(wrap([{ label: 'Solo' }]));
    const node = screen.getByText('Solo');
    expect(node.getAttribute('aria-current')).toBe('page');
  });

  it('renders a multi-segment trail with ChevronRight between items', () => {
    const { container } = render(
      wrap([
        { label: 'Meowth', href: '/' },
        { label: 'Sessions', href: '/sessions' },
        { label: 'Detail' },
      ]),
    );
    expect(screen.getByRole('link', { name: 'Meowth' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByText('Detail').getAttribute('aria-current')).toBe('page');
    // Two separators between three items.
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(2);
  });

  it('renders link items with hover-color transition class', () => {
    render(wrap([{ label: 'Home', href: '/' }, { label: 'Tail' }]));
    const link = screen.getByRole('link', { name: 'Home' });
    expect(link.className).toContain('hover:text-foreground');
  });
});
