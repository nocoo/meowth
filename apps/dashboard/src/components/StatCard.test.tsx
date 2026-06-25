import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import StatCard from './StatCard';

describe('StatCard (Stage C1)', () => {
  it('renders title + body in the L2 surface', () => {
    const { container } = render(<StatCard title="Tokens" body={5} />);
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
    expect((container.firstChild as HTMLElement).className).toContain('bg-secondary');
    expect((container.firstChild as HTMLElement).className).toContain('rounded-card');
  });

  it('accepts a ReactNode body (string, number, JSX)', () => {
    render(<StatCard title="Custom" body={<span data-testid="custom-body">hello</span>} />);
    expect(screen.getByTestId('custom-body')).toBeInTheDocument();
  });

  it('renders an optional icon when provided', () => {
    const { container } = render(<StatCard title="Daemon" body="Reachable" icon={Activity} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('omits the icon slot when no icon prop is supplied', () => {
    const { container } = render(<StatCard title="Daemon" body="Reachable" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeFalsy();
  });
});
