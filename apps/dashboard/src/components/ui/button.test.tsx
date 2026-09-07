import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders default size as h-10 form primary', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('h-10');
  });

  it('maps xs to compact height', () => {
    render(<Button size="xs">Compact</Button>);
    expect(screen.getByRole('button', { name: 'Compact' }).className).toContain('h-8');
  });

  it('renders as Slot child when asChild=true', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.tagName).toBe('A');
  });
});
