import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import AgentsPage from './AgentsPage';

afterEach(() => {
  cleanup();
});

describe('AgentsPage', () => {
  it('renders the Agents heading and the empty placeholder copy', () => {
    const router = createMemoryRouter([{ path: '*', element: <AgentsPage /> }], {
      initialEntries: ['/agents'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});
