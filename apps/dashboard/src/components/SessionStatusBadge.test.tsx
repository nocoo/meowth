import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SessionStatusBadge from './SessionStatusBadge';

describe('SessionStatusBadge', () => {
  for (const [status, label] of [
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['running', 'Running'],
  ] as const) {
    it(`maps ${status} to the expected label`, () => {
      render(<SessionStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  }

  it('falls back to secondary styling for unknown statuses', () => {
    render(<SessionStatusBadge status="queued" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
