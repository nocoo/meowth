import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppLink, BasaltProviders, MEOWTH_ACCENT } from './basalt-providers';

describe('BasaltProviders', () => {
  it('renders children', () => {
    render(
      <BasaltProviders>
        <p>ready</p>
      </BasaltProviders>,
    );
    expect(screen.getByText('ready')).toBeInTheDocument();
  });
});

describe('MEOWTH_ACCENT', () => {
  it('pins Meowth blue as the primary swatch', () => {
    expect(MEOWTH_ACCENT.primary.light).toBe('217 91% 60%');
    expect(MEOWTH_ACCENT.primary.dark).toBe('217 91% 65%');
  });
});

describe('AppLink', () => {
  it('keeps http(s) hrefs as native anchors', () => {
    const external = ['https://', 'example.com/x'].join('');
    render(
      <AppLink href={external} className="ext">
        External
      </AppLink>,
    );
    const link = screen.getByRole('link', { name: 'External' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', external);
  });

  it('maps in-app hrefs through react-router Link', () => {
    render(
      <MemoryRouter>
        <AppLink href="/overview">Overview</AppLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Overview' });
    expect(link).toHaveAttribute('href', '/overview');
  });
});
