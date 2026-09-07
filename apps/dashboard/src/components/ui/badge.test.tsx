import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders default badge with children text', () => {
    render(<Badge>hello-badge</Badge>);
    expect(screen.getByText('hello-badge')).toBeInTheDocument();
  });

  it('renders the success variant', () => {
    render(<Badge variant="success">yes</Badge>);
    expect(screen.getByText('yes')).toBeInTheDocument();
  });
});
