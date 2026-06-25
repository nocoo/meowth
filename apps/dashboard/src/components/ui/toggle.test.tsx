import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toggle, toggleVariants } from './toggle';

describe('Toggle (G2 smoke)', () => {
  it('renders an unpressed button by default', () => {
    render(<Toggle aria-label="bold">B</Toggle>);
    const node = screen.getByRole('button', { name: 'bold' });
    expect(node).toBeInTheDocument();
    expect(node.getAttribute('data-state')).toBe('off');
  });

  it('respects pressed=true', () => {
    render(
      <Toggle aria-label="italic" pressed>
        I
      </Toggle>,
    );
    expect(screen.getByRole('button', { name: 'italic' }).getAttribute('data-state')).toBe('on');
  });

  it('exposes toggleVariants as a CVA helper', () => {
    expect(typeof toggleVariants).toBe('function');
    const cls = toggleVariants();
    expect(typeof cls).toBe('string');
    expect(cls.length).toBeGreaterThan(0);
  });
});
