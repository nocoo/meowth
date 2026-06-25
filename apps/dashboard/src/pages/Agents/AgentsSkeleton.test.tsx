import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AgentsSkeleton from './AgentsSkeleton';

describe('AgentsSkeleton (Stage C2)', () => {
  it('preserves the table head shape (4 columns) so the layout does not reflow on data swap', () => {
    render(<AgentsSkeleton />);
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Executable' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
  });

  it('emits 5 rows × 4 cells of animate-pulse skeletons', () => {
    const { container } = render(<AgentsSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(5 * 4);
  });
});
