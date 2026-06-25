import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsSkeleton from './SettingsSkeleton';

// Skeleton tests for Phase 2 Stage C5. Renders only the Daemon
// row label + Notice-shaped placeholder; the Dashboard build row
// stays owned by the Page (its value is a compile-time constant
// and is never a fake placeholder).

describe('SettingsSkeleton (Stage C5)', () => {
  it('renders 2 animate-pulse placeholders (Daemon label + Notice slot)', () => {
    const { container } = render(<SettingsSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBe(2);
  });
});
