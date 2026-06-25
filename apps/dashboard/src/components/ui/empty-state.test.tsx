import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState (G1 smoke)', () => {
  it('renders icon, title, description, and action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No sessions"
        description="Run an agent to populate this view."
        action={
          <button type="button" name="cta">
            Run agent
          </button>
        }
      />,
    );
    expect(screen.getByText('No sessions')).toBeInTheDocument();
    expect(screen.getByText('Run an agent to populate this view.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run agent' })).toBeInTheDocument();
  });

  it('renders title alone (no description, no action) for the minimal shape', () => {
    render(<EmptyState icon={Inbox} title="Solo title" />);
    expect(screen.getByText('Solo title')).toBeInTheDocument();
  });

  it('applies error tone class when tone="error"', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Error state" tone="error" />);
    // tone="error" must (a) keep the L2 shell intact and (b) route the
    // icon path through `text-destructive-text` so the --destructive-text
    // token added in A3 actually gets used. Pin both contracts.
    expect(screen.getByText('Error state')).toBeInTheDocument();
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
    expect((container.firstChild as HTMLElement).className).toMatch(/bg-secondary/);
    // The Lucide icon is rendered as an inline <svg>; its parent inherits
    // the text color class so `text-destructive-text` should appear in
    // the rendered HTML when tone="error".
    expect(container.innerHTML).toContain('text-destructive-text');
  });
});
