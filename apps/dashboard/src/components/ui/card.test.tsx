import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardContent, CardHeader, CardTitle } from './card';

describe('Card', () => {
  it('renders as a Basalt LayerCard surface', () => {
    const { container } = render(<Card>body</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-basalt-surface');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders header title inside the card', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Daemon</CardTitle>
        </CardHeader>
        <CardContent>Reachable</CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Daemon' })).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
  });
});
