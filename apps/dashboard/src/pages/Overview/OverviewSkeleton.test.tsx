import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OverviewSkeleton from './OverviewSkeleton';

describe('OverviewSkeleton (Stage C1)', () => {
  it('renders metric and activity placeholders with the L2 surface class', () => {
    const { container } = render(<OverviewSkeleton />);
    const tiles = container.querySelectorAll('[data-basalt-surface]');
    expect(tiles.length).toBe(6);
  });

  it('reserves metric values and recent activity rows', () => {
    const { container } = render(<OverviewSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(16);
  });
});
