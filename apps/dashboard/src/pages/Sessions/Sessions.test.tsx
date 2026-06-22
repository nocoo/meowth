import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import SessionDetailPage from './SessionDetailPage';
import SessionsListPage from './SessionsListPage';

afterEach(() => {
  cleanup();
});

describe('SessionsListPage', () => {
  it('renders the Sessions heading and the empty placeholder copy', () => {
    const router = createMemoryRouter([{ path: '/sessions', element: <SessionsListPage /> }], {
      initialEntries: ['/sessions'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});

describe('SessionDetailPage', () => {
  it('threads :id from the route through useSessionDetailViewModel into the DOM', () => {
    const id = '019ee83f-661f-715f-b186-2db67a23b559';
    const router = createMemoryRouter([{ path: '/sessions/:id', element: <SessionDetailPage /> }], {
      initialEntries: [`/sessions/${id}`],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Session' })).toBeInTheDocument();
    expect(screen.getByTestId('session-detail-id').textContent).toBe(id);
  });
});
