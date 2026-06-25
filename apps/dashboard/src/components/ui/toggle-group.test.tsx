import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

describe('ToggleGroup (G2 smoke)', () => {
  it('renders multiple ToggleGroupItem children in a single-select group', () => {
    render(
      <ToggleGroup type="single" defaultValue="a" aria-label="period">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
        <ToggleGroupItem value="c">C</ToggleGroupItem>
      </ToggleGroup>,
    );
    const a = screen.getByRole('radio', { name: 'A' });
    const b = screen.getByRole('radio', { name: 'B' });
    expect(a).toBeInTheDocument();
    expect(b).toBeInTheDocument();
    expect(a.getAttribute('data-state')).toBe('on');
    expect(b.getAttribute('data-state')).toBe('off');
  });

  it('supports type="multiple" with multiple defaults', () => {
    render(
      <ToggleGroup type="multiple" defaultValue={['x', 'y']} aria-label="filters">
        <ToggleGroupItem value="x">X</ToggleGroupItem>
        <ToggleGroupItem value="y">Y</ToggleGroupItem>
        <ToggleGroupItem value="z">Z</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole('button', { name: 'X' }).getAttribute('data-state')).toBe('on');
    expect(screen.getByRole('button', { name: 'Y' }).getAttribute('data-state')).toBe('on');
    expect(screen.getByRole('button', { name: 'Z' }).getAttribute('data-state')).toBe('off');
  });
});
