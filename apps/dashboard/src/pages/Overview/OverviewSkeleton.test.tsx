import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OverviewSkeleton from './OverviewSkeleton';

describe('OverviewSkeleton (Stage C1)', () => {
  it('renders 4 placeholder tiles with the L2 surface class', () => {
    const { container } = render(<OverviewSkeleton />);
    const tiles = container.querySelectorAll('.bg-secondary.rounded-card.p-4');
    expect(tiles.length).toBe(4);
  });

  it('each tile has 2 animate-pulse skeleton bars (title + value)', () => {
    const { container } = render(<OverviewSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(8);
  });
});
