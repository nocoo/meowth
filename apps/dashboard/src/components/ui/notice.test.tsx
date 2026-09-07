import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice, noticeVariants } from './notice';

describe('Notice (G2 smoke)', () => {
  it('renders body content (default variant)', () => {
    render(<Notice>plain-notice-body</Notice>);
    expect(screen.getByText('plain-notice-body')).toBeInTheDocument();
  });

  it('success variant uses text-basalt-heatmap-green-4 token utility', () => {
    const cls = noticeVariants({ variant: 'success' });
    expect(cls).toContain('text-basalt-heatmap-green-4');

    const { container } = render(<Notice variant="success">success-body</Notice>);
    expect(screen.getByText('success-body')).toBeInTheDocument();
    expect(container.innerHTML).toContain('text-basalt-heatmap-green-4');
  });

  it('destructive/warning/info variants use Basalt semantic colors', () => {
    expect(noticeVariants({ variant: 'destructive' })).toContain('text-basalt-danger');
    expect(noticeVariants({ variant: 'warning' })).toContain('text-basalt-warning');
    expect(noticeVariants({ variant: 'info' })).toContain('text-basalt-info');
  });
});
