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
    expect(span?.className).toContain('text-basalt-danger');
    expect(container.textContent).toBe('hello world');
  });

  it('keeps red across a bold-off (22) within a colored run', () => {
    const nodes = ansiToReactNodes(`${ESC}[31;1mA${ESC}[22mB${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.className).toContain('text-basalt-danger');
    expect(spans[0]?.className).toContain('font-bold');
    expect(spans[1]?.className).toContain('text-basalt-danger');
    expect(spans[1]?.className).not.toContain('font-bold');
    expect(container.textContent).toBe('AB');
  });

  it('maps 256-color foreground codes to a basic class', () => {
    const nodes = ansiToReactNodes(`${ESC}[38;5;196mX${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/text-basalt-danger/);
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

  it('drops an OSC sequence (ESC ] ... BEL) including the payload', () => {
    const nodes = ansiToReactNodes(`before${ESC}]0;title\x07after`);
    const text = asString(nodes);
    expect(text).toBe('beforeafter');
    expect(text).not.toContain('\x07');
    expect(text).not.toContain('title');
  });

  it('drops an OSC sequence terminated by ESC \\ (ST)', () => {
    const nodes = ansiToReactNodes(`a${ESC}]52;c;Zm9v${ESC}\\b`);
    expect(asString(nodes)).toBe('ab');
  });

  it('drops DCS / PM / APC / SOS string-control sequences', () => {
    const samples: [string, string][] = [
      [`a${ESC}Pq;data${ESC}\\b`, 'ab'], // DCS
      [`a${ESC}^private${ESC}\\b`, 'ab'], // PM
      [`a${ESC}_app${ESC}\\b`, 'ab'], // APC
      [`a${ESC}Xstart${ESC}\\b`, 'ab'], // SOS
    ];
    for (const [input, expected] of samples) {
      const nodes = ansiToReactNodes(input);
      expect(asString(nodes)).toBe(expected);
    }
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
    expect(span?.className).toContain('text-basalt-heatmap-green-4');
    expect(span?.className).toContain('bg-basalt-danger-tint');
  });

  it('resets cleanly between styled runs', () => {
    const nodes = ansiToReactNodes(`${ESC}[31mA${ESC}[0mB${ESC}[34mC${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(2);
    expect(spans[0]?.className).toContain('text-basalt-danger');
    expect(spans[1]?.className).toContain('text-basalt-info');
    expect(container.textContent).toBe('ABC');
  });

  it('skips truecolor SGR arguments without rendering them', () => {
    const nodes = ansiToReactNodes(`${ESC}[38;2;10;20;30mA${ESC}[48;2;1;2;3mB${ESC}[0m`);
    expect(asString(nodes)).toBe('AB');
  });

  it('drops a dangling ESC at the end of input', () => {
    expect(asString(ansiToReactNodes(`ok${ESC}`))).toBe('ok');
  });

  it('clears background with SGR 49', () => {
    const nodes = ansiToReactNodes(`${ESC}[42mA${ESC}[49mB${ESC}[0m`);
    expect(asString(nodes)).toBe('AB');
  });

  it('maps 256-color background codes', () => {
    const nodes = ansiToReactNodes(`${ESC}[48;5;21mX${ESC}[0m`);
    const { container } = render(<div>{nodes}</div>);
    expect(container.querySelector('span')?.className).toMatch(/bg-basalt-/);
    expect(container.textContent).toBe('X');
  });

  it('treats ESC[m (empty SGR) as a reset', () => {
    const nodes = ansiToReactNodes(`${ESC}[31mA${ESC}[mB`);
    const { container } = render(<div>{nodes}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans).toHaveLength(1);
    const first = spans[0];
    expect(first?.className).toContain('text-basalt-danger');
    expect(first?.textContent).toBe('A');
    expect(container.textContent).toBe('AB');
  });
});
