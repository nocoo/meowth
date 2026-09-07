import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders title as h1 and wires headingId for aria-labelledby', () => {
    render(<PageHeader title="Tokens" headingId="tokens-heading" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tokens' })).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toHaveAttribute('id', 'tokens-heading');
  });

  it('renders description and trailing actions', () => {
    render(
      <PageHeader
        title="Tokens"
        description="3 active"
        actions={<button type="button">Create token</button>}
      />,
    );
    expect(screen.getByText('3 active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create token' })).toBeInTheDocument();
  });
});
