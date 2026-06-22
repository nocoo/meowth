import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import OverviewPage from './OverviewPage';

afterEach(() => {
  cleanup();
});

describe('OverviewPage', () => {
  it('renders the Overview heading and the empty placeholder copy', () => {
    const router = createMemoryRouter([{ path: '*', element: <OverviewPage /> }], {
      initialEntries: ['/overview'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});
