import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardContent, CardHeader, CardTitle } from './card';

describe('Card (zhe L2)', () => {
  it('uses bg-secondary rounded-card with no border or shadow', () => {
    const { container } = render(<Card>body</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('bg-secondary');
    expect(root.className).toContain('rounded-card');
    expect(root.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(root.className).not.toContain('shadow');
  });

  it('renders header title inside the L2 shell', () => {
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
