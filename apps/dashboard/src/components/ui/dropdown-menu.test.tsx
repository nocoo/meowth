import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

describe('DropdownMenu (G2 smoke)', () => {
  it('renders Trigger + Content + Label + Item + Separator with defaultOpen', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <button type="button">open-menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>label-section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>item-1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('label-section')).toBeInTheDocument();
    expect(screen.getByText('item-1')).toBeInTheDocument();
  });
});
