import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
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
    expect(screen.getByText('Error state')).toBeInTheDocument();
    expect(container.innerHTML).toContain('text-destructive-text');
  });
});
