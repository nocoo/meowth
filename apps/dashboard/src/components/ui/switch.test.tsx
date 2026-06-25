import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch } from './switch';

describe('Switch (G2 smoke)', () => {
  it('renders an unchecked switch by default', () => {
    render(<Switch aria-label="notifications" />);
    const node = screen.getByRole('switch', { name: 'notifications' });
    expect(node).toBeInTheDocument();
    expect(node.getAttribute('aria-checked')).toBe('false');
  });

  it('respects defaultChecked=true', () => {
    render(<Switch aria-label="toggle-on" defaultChecked />);
    expect(screen.getByRole('switch', { name: 'toggle-on' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
