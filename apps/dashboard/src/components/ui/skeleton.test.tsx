import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './skeleton';

describe('Skeleton (G1 smoke)', () => {
  it('renders a div with animate-pulse and rounded-md base classes', () => {
    render(<Skeleton data-testid="sk" />);
    const node = screen.getByTestId('sk');
    expect(node).toBeInTheDocument();
    expect(node.className).toMatch(/animate-pulse/);
    expect(node.className).toMatch(/rounded-md/);
  });

  it('merges user-supplied className', () => {
    render(<Skeleton className="h-4 w-16" data-testid="sk-sized" />);
    const node = screen.getByTestId('sk-sized');
    expect(node.className).toContain('h-4');
    expect(node.className).toContain('w-16');
  });
});
