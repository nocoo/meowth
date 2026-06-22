import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ansiToReactNodes } from './ansi';

afterEach(() => {
  cleanup();
});

const ESC = '\x1b';

function asString(nodes: ReactNode[]): string {
  const { container } = render(<div>{nodes}</div>);
  return container.textContent ?? '';
}

describe('ansiToReactNodes', () => {
  it('returns [] for empty input', () => {
    expect(ansiToReactNodes('')).toEqual([]);
  });

  it('returns a single string node when there are no escapes', () => {
    const nodes = ansiToReactNodes('hello world');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe('hello world');
  });

  it('colors a styled segment and leaves trailing text unstyled', () => {
    const nodes = ansiToReactNodes(`${ESC}[31mhello${ESC}[0m world`);
    const { container } = render(<div>{nodes}</div>);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.className).toContain('text-red-600');
    expect(container.textContent).toBe('hello world');
  });

  it('keeps red across a bold-off (22) within a colored run', () => {
    const nodes = ansiToReactNodes(`${ESC}[31;1mA${ESC}[22mB${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.className).toContain('text-red-600');
    expect(spans[0]?.className).toContain('font-bold');
    expect(spans[1]?.className).toContain('text-red-600');
    expect(spans[1]?.className).not.toContain('font-bold');
    expect(container.textContent).toBe('AB');
  });

  it('maps 256-color foreground codes to a basic class', () => {
    const nodes = ansiToReactNodes(`${ESC}[38;5;196mX${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/text-(red|brightRed)/i);
    expect(container.textContent).toBe('X');
  });

  it('drops non-SGR CSI sequences such as the erase-screen command', () => {
    const nodes = ansiToReactNodes(`before${ESC}[2Jafter`);
    const text = asString(nodes);
    expect(text).toBe('beforeafter');
    expect(text).not.toContain(ESC);
  });

  it('drops bare ESC bytes that are not followed by [', () => {
    const nodes = ansiToReactNodes(`a${ESC}7b`);
    expect(asString(nodes)).toBe('ab');
  });

  it('handles an unterminated CSI by dropping the tail safely', () => {
    const nodes = ansiToReactNodes(`ok${ESC}[31`);
    expect(asString(nodes)).toBe('ok');
  });

  it('does not inject script payloads — angle brackets stay as text', () => {
    const payload = '<script>alert(1)</script>';
    const { container } = render(<div>{ansiToReactNodes(payload)}</div>);
    expect(container.textContent).toBe(payload);
    expect(container.querySelector('script')).toBeNull();
  });

  it('handles inverse video by swapping fg and bg classes', () => {
    const nodes = ansiToReactNodes(`${ESC}[31;42;7mX${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-green-600');
    expect(span?.className).toContain('bg-red-600');
  });

  it('resets cleanly between styled runs', () => {
    const nodes = ansiToReactNodes(`${ESC}[31mA${ESC}[0mB${ESC}[34mC${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.className).toContain('text-red-600');
    expect(spans[1]?.className).toContain('text-blue-600');
    expect(container.textContent).toBe('ABC');
  });

  it('treats ESC[m (empty SGR) as a reset', () => {
    const nodes = ansiToReactNodes(`${ESC}[31mA${ESC}[mB`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(1);
    const first = spans[0];
    expect(first?.className).toContain('text-red-600');
    expect(first?.textContent).toBe('A');
    expect(container.textContent).toBe('AB');
  });
});
