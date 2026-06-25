import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, badgeVariants } from './badge';

describe('Badge (G1 smoke)', () => {
  it('renders default badge with children text', () => {
    render(<Badge>hello-badge</Badge>);
    expect(screen.getByText('hello-badge')).toBeInTheDocument();
  });

  it('exposes badgeVariants as a CVA helper returning a className string', () => {
    expect(typeof badgeVariants).toBe('function');
    const cls = badgeVariants();
    expect(typeof cls).toBe('string');
    expect(cls.length).toBeGreaterThan(0);
  });

  it('renders as Slot child when asChild=true', () => {
    render(
      <Badge asChild>
        <a href="/test">link-badge</a>
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'link-badge' });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe('A');
  });

  it('indigo variant emits the --indigo token utility classes', () => {
    // The copied badge.tsx ships an "indigo" variant; if the variant
    // class string ever loses bg-indigo / text-indigo-foreground, the
    // index.css indigo tokens become orphans. Pin both directions.
    const cls = badgeVariants({ variant: 'indigo' });
    expect(cls).toContain('bg-indigo');
    expect(cls).toContain('text-indigo-foreground');

    render(<Badge variant="indigo">indigo-badge</Badge>);
    const node = screen.getByText('indigo-badge');
    expect(node.className).toContain('bg-indigo');
    expect(node.className).toContain('text-indigo-foreground');
  });
});
