import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

describe('Select (G2 smoke)', () => {
  it('renders Trigger + Value placeholder closed by default', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="x">x-label</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('choose')).toBeInTheDocument();
  });

  it('renders Items when defaultOpen=true', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">alpha</SelectItem>
          <SelectItem value="b">bravo</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('bravo')).toBeInTheDocument();
  });
});
