import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChatSkeleton from './ChatSkeleton';

describe('ChatSkeleton', () => {
  it('renders three placeholder regions (picker / messages / composer)', () => {
    const { container } = render(<ChatSkeleton />);
    expect(container.querySelector('[data-slot="skeleton-picker"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="skeleton-messages"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="skeleton-composer"]')).not.toBeNull();
  });

  it('uses the rounded-basalt-card / bg-basalt-secondary L2 surface class', () => {
    const { container } = render(<ChatSkeleton />);
    const wrapper = container.querySelector('[data-slot="chat-skeleton"]') as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper).toHaveAttribute('data-basalt-surface');
  });
});
