import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders a named text field', () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});
