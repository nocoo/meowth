import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionDivider } from './section-divider';

describe('SectionDivider (G2 smoke)', () => {
  it('renders title + children + optional action', () => {
    render(
      <SectionDivider
        title="section-title"
        action={
          <button type="button" name="cta">
            section-cta
          </button>
        }
      >
        <p>section-body</p>
      </SectionDivider>,
    );
    expect(screen.getByText('section-title')).toBeInTheDocument();
    expect(screen.getByText('section-body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'section-cta' })).toBeInTheDocument();
  });
});
