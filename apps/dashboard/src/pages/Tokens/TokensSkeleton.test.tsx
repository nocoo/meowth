import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TokensSkeleton from './TokensSkeleton';

// Skeleton tests for Phase 2 Stage C4. Verifies the placeholder
// reserves the same 5×5 table footprint as TokensContent.

describe('TokensSkeleton (Stage C4)', () => {
  it('preserves the 4 named column headers from TokensContent', () => {
    render(<TokensSkeleton />);
    for (const label of ['Name', 'Prefix', 'Created', 'Last used']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('renders 25 animate-pulse cells (5 rows × 5 cols)', () => {
    const { container } = render(<TokensSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBe(5 * 5);
  });
});
