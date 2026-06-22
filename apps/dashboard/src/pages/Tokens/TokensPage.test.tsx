import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import TokensPage from './TokensPage';

afterEach(() => {
  cleanup();
});

describe('TokensPage', () => {
  it('renders the Tokens heading and the empty placeholder copy', () => {
    const router = createMemoryRouter([{ path: '*', element: <TokensPage /> }], {
      initialEntries: ['/tokens'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tokens' })).toBeInTheDocument();
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});
