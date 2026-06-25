import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SortHeader } from './sort-header';

describe('SortHeader (G2 smoke)', () => {
  function renderTable(props: {
    label: string;
    sortKey: string;
    currentSort: string;
    currentDir: 'asc' | 'desc';
    onSort: (k: string) => void;
  }) {
    return render(
      <table>
        <thead>
          <tr>
            <SortHeader {...props} />
          </tr>
        </thead>
      </table>,
    );
  }

  it('renders as a clickable column header with sort=none when inactive', () => {
    const onSort = vi.fn();
    renderTable({
      label: 'name',
      sortKey: 'name',
      currentSort: 'created_at',
      currentDir: 'desc',
      onSort,
    });
    const th = screen.getAllByRole('columnheader').at(-1) as HTMLElement;
    expect(th.getAttribute('aria-sort')).toBe('none');
  });

  it('exposes aria-sort=ascending when active asc', () => {
    renderTable({
      label: 'name',
      sortKey: 'name',
      currentSort: 'name',
      currentDir: 'asc',
      onSort: () => {},
    });
    const th = screen.getAllByRole('columnheader').at(-1) as HTMLElement;
    expect(th.getAttribute('aria-sort')).toBe('ascending');
  });

  it('exposes aria-sort=descending when active desc', () => {
    renderTable({
      label: 'name',
      sortKey: 'name',
      currentSort: 'name',
      currentDir: 'desc',
      onSort: () => {},
    });
    const th = screen.getAllByRole('columnheader').at(-1) as HTMLElement;
    expect(th.getAttribute('aria-sort')).toBe('descending');
  });

  it('invokes onSort(sortKey) when the button is clicked', async () => {
    const onSort = vi.fn();
    renderTable({
      label: 'created',
      sortKey: 'created_at',
      currentSort: 'name',
      currentDir: 'asc',
      onSort,
    });
    await userEvent.click(screen.getByRole('button', { name: /created/i }));
    expect(onSort).toHaveBeenCalledWith('created_at');
  });
});
