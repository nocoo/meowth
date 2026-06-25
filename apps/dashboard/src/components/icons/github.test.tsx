import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Github } from './github';

// Smoke tests for the meowth-local GitHub icon. Lucide's
// `createLucideIcon` returns a forwardRef React component that
// renders an `<svg>` containing the configured `<path>` children.
// We assert just enough to catch a build regression — the
// component renders an svg with the expected number of paths,
// honours `className` / `aria-hidden`, and ships at a usable size
// when consumed via the `h-[18px] w-[18px]` AppShell idiom.

describe('Github icon (meowth-local, lucide v0 extraction)', () => {
  it('renders an <svg> element with two <path> children', () => {
    const { container } = render(<Github aria-hidden="true" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const paths = svg?.querySelectorAll('path') ?? [];
    expect(paths.length).toBe(2);
  });

  it('forwards className to the svg root', () => {
    const { container } = render(<Github className="h-[18px] w-[18px]" aria-hidden="true" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') ?? '').toContain('h-[18px]');
    expect(svg?.getAttribute('class') ?? '').toContain('w-[18px]');
  });

  it('honours aria-hidden so the icon is decorative by default', () => {
    const { container } = render(<Github aria-hidden="true" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
