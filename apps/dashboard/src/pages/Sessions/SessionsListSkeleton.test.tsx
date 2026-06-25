import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SessionsListSkeleton from './SessionsListSkeleton';

// Skeleton tests for Phase 2 Stage C3a. Verifies the placeholder
// reserves the same 5×5 table footprint as SessionsListContent.

describe('SessionsListSkeleton (Stage C3a)', () => {
  it('preserves the 5 column headers from SessionsListContent', () => {
    render(<SessionsListSkeleton />);
    for (const label of ['Backend', 'Status', 'Model', 'Started', 'Thread']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('renders 25 animate-pulse cells (5 rows × 5 cols)', () => {
    const { container } = render(<SessionsListSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(5 * 5);
  });

  it('wraps the placeholder table in a rounded-card bg-secondary L2 surface', () => {
    const { container } = render(<SessionsListSkeleton />);
    const wrap = container.querySelector('.rounded-card.bg-secondary');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-slot="table-container"]')).not.toBeNull();
  });
});
