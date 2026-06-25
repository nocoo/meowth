import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './textarea';

describe('Textarea (G2 smoke)', () => {
  it('renders as a textbox with placeholder', () => {
    render(<Textarea placeholder="say-something" />);
    const node = screen.getByPlaceholderText('say-something');
    expect(node).toBeInTheDocument();
    expect(node.tagName).toBe('TEXTAREA');
  });

  it('accepts a custom className that merges with defaults', () => {
    render(<Textarea className="h-32" data-testid="tx" />);
    const node = screen.getByTestId('tx');
    expect(node.className).toContain('h-32');
  });
});
