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

  it('uses the rounded-card / bg-secondary L2 surface class', () => {
    const { container } = render(<ChatSkeleton />);
    const wrapper = container.querySelector('[data-slot="chat-skeleton"]') as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toMatch(/rounded-card/);
    expect(wrapper.className).toMatch(/bg-secondary/);
  });
});
