import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsPage from './SettingsPage';

afterEach(() => {
  cleanup();
});

describe('SettingsPage', () => {
  it('renders the Settings heading and the unknown-daemon placeholder copy', () => {
    const router = createMemoryRouter([{ path: '*', element: <SettingsPage /> }], {
      initialEntries: ['/settings'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });
});
