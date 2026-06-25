import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Separator } from './separator';

describe('Separator (G1 smoke)', () => {
  it('renders a horizontal separator (default)', () => {
    render(<Separator data-testid="sep-h" />);
    const node = screen.getByTestId('sep-h');
    expect(node).toBeInTheDocument();
    expect(node.getAttribute('data-orientation')).toBe('horizontal');
  });

  it('renders a vertical separator when orientation="vertical"', () => {
    render(<Separator orientation="vertical" data-testid="sep-v" />);
    expect(screen.getByTestId('sep-v').getAttribute('data-orientation')).toBe('vertical');
  });
});
