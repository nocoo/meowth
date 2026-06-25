import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Label } from './label';

describe('Label (G2 smoke)', () => {
  it('renders the label text and associates with htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">email-label</Label>
        <input id="email" />
      </>,
    );
    const label = screen.getByText('email-label');
    expect(label).toBeInTheDocument();
    expect(label.getAttribute('for')).toBe('email');
  });
});
