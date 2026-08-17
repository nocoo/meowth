import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from './dialog';

describe('Dialog (pew recipe)', () => {
  it('renders L1 card panel with soft overlay, no slide classes', () => {
    render(
      <Dialog open>
        <DialogContent aria-label="Create token">
          <DialogTitle>Create token</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Create token' });
    expect(dialog.className).toContain('bg-card');
    expect(dialog.className).toContain('rounded-xl');
    expect(dialog.className).not.toContain('slide-in-from-left');
    expect(dialog.className).not.toContain('bg-background');
  });
});
