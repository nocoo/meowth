import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SessionDetailSkeleton from './SessionDetailSkeleton';

// Skeleton tests for Phase 2 Stage C3b. The placeholder reserves
// the SessionDetailContent footprint: 3 header lines + 3 message
// rows of 2 lines each → 9 animate-pulse cells.

describe('SessionDetailSkeleton (Stage C3b)', () => {
  it('renders 9 animate-pulse cells (3 header + 3 message rows × 2)', () => {
    const { container } = render(<SessionDetailSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(3 + 3 * 2);
  });
});
