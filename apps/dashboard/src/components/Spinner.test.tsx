import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Spinner from './Spinner';

afterEach(() => {
  cleanup();
});

describe('Spinner', () => {
  it('renders an accessible loading indicator with animate-spin', () => {
    render(<Spinner />);
    const node = screen.getByRole('status', { name: 'Loading…' });
    expect(node).toBeInTheDocument();
    expect(node).toHaveClass('animate-spin');
  });

  it('honours a custom label', () => {
    render(<Spinner label="Fetching agents" />);
    expect(screen.getByRole('status', { name: 'Fetching agents' })).toBeInTheDocument();
  });
});
