import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice, noticeVariants } from './notice';

describe('Notice (G2 smoke)', () => {
  it('renders body content (default variant)', () => {
    render(<Notice>plain-notice-body</Notice>);
    expect(screen.getByText('plain-notice-body')).toBeInTheDocument();
  });

  it('success variant uses text-success-text token utility', () => {
    // The copied notice.tsx routes success variant to text-success-text;
    // pin both the CVA helper and rendered DOM so the index.css
    // `--success-text` token always has a runtime consumer.
    const cls = noticeVariants({ variant: 'success' });
    expect(cls).toContain('text-success-text');

    const { container } = render(<Notice variant="success">success-body</Notice>);
    expect(screen.getByText('success-body')).toBeInTheDocument();
    expect(container.innerHTML).toContain('text-success-text');
  });

  it('destructive/warning/info variants route to their respective -text tokens', () => {
    expect(noticeVariants({ variant: 'destructive' })).toContain('text-destructive-text');
    expect(noticeVariants({ variant: 'warning' })).toContain('text-warning-text');
    expect(noticeVariants({ variant: 'info' })).toContain('text-info-text');
  });
});
