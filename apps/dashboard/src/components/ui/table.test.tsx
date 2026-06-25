import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

describe('Table (G2 smoke)', () => {
  it('renders the full table primitive surface', () => {
    render(
      <Table>
        <TableCaption>captionT</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>colA</TableHead>
            <TableHead>colB</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>cellA1</TableCell>
            <TableCell>cellB1</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>footA</TableCell>
            <TableCell>footB</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    expect(screen.getByText('captionT')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'colA' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'cellA1' })).toBeInTheDocument();
    expect(screen.getByText('footA')).toBeInTheDocument();
  });
});
