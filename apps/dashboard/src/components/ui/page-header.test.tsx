import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';

describe('PageHeader (zhe)', () => {
  it('renders title as h2 and wires headingId for aria-labelledby', () => {
    render(<PageHeader title="Tokens" headingId="tokens-heading" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Tokens' });
    expect(heading).toHaveAttribute('id', 'tokens-heading');
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
