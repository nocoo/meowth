import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

describe('Sheet (G1 smoke)', () => {
  it('renders Trigger + Content + Header/Title/Description/Footer + Close when defaultOpen', () => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger asChild>
          <button type="button">open-sheet</button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>sheet-title</SheetTitle>
            <SheetDescription>sheet-description</SheetDescription>
          </SheetHeader>
          <p>sheet-body</p>
          <SheetFooter>
            <SheetClose asChild>
              <button type="button">close-sheet</button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('sheet-title')).toBeInTheDocument();
    expect(screen.getByText('sheet-description')).toBeInTheDocument();
    expect(screen.getByText('sheet-body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close-sheet' })).toBeInTheDocument();
  });
});
