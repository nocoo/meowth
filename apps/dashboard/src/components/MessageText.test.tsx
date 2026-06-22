import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MessageText from './MessageText';

afterEach(() => {
  cleanup();
});

const ESC = '\x1b';

describe('MessageText', () => {
  it('renders plain text inside a <pre> wrapper', () => {
    const { container } = render(<MessageText content="hello world" />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe('hello world');
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('emits a styled span for an ANSI-colored segment', () => {
    const { container } = render(<MessageText content={`${ESC}[31mERR${ESC}[0m`} />);
    const span = container.querySelector('pre > span');
    expect(span).not.toBeNull();
    expect(span?.className).toContain('text-red-600');
    expect(span?.textContent).toBe('ERR');
  });

  it('renders an HTML/script payload as text — no live element gets created', () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const { container } = render(<MessageText content={payload} />);
    expect(container.textContent).toBe(payload);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
