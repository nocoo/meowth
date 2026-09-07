import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from './dialog';

describe('Dialog', () => {
  it('renders a labelled dialog panel', () => {
    render(
      <Dialog open>
        <DialogContent aria-label="Create token">
          <DialogTitle>Create token</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Create token' })).toBeInTheDocument();
  });
});
