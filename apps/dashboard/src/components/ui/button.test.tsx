import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button (zhe density)', () => {
  it('renders default size as h-10 form primary', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('h-10');
    expect(btn).toHaveAttribute('data-size', 'default');
  });

  it('maps sm to h-9 and xs to h-8 toolbar compact', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-9');
    expect(buttonVariants({ size: 'xs' })).toContain('h-8');
    expect(buttonVariants({ size: 'xs' })).toContain('rounded-widget');
    expect(buttonVariants({ size: 'icon-sm' })).toContain('h-8');
    expect(buttonVariants({ size: 'icon-sm' })).toContain('w-8');
  });

  it('uses L3 outline surface (border-border bg-secondary)', () => {
    const cls = buttonVariants({ variant: 'outline' });
    expect(cls).toContain('border-border');
    expect(cls).toContain('bg-secondary');
    expect(cls).not.toContain('bg-background');
  });

  it('renders as Slot child when asChild=true', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.tagName).toBe('A');
    expect(link.className).toContain('h-10');
  });
});
