import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input, inputVariants } from './input';

describe('Input (zhe density)', () => {
  it('renders default as h-10 L3 surface', () => {
    render(<Input aria-label="Name" />);
    const el = screen.getByLabelText('Name');
    expect(el.className).toContain('h-10');
    expect(el.className).toContain('bg-secondary');
    expect(el.className).toContain('border-border');
    expect(el.className).not.toContain('bg-background');
  });

  it('maps sm to h-8 toolbar compact', () => {
    expect(inputVariants({ size: 'sm' })).toContain('h-8');
    expect(inputVariants({ size: 'sm' })).toContain('rounded-widget');
  });

  it('uses soft focus ring without ring-offset', () => {
    const cls = inputVariants();
    expect(cls).toContain('focus-visible:ring-[3px]');
    expect(cls).toContain('focus-visible:ring-ring/50');
    expect(cls).not.toContain('ring-offset');
  });
});
