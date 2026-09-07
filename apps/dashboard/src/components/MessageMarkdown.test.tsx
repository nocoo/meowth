import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MessageMarkdown from './MessageMarkdown';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageMarkdown', () => {
  it('renders headings, emphasis, nested lists, quotes, and task lists', () => {
    const { container } = render(
      <MessageMarkdown
        content={
          '## Release notes\n\n**Completed** and *verified*.\n\n- First\n  - Nested\n\n1. Ordered\n\n> A note\n\n- [x] Ready'
        }
      />,
    );
    expect(screen.getByRole('heading', { name: 'Release notes', level: 2 })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('Completed');
    expect(container.querySelector('em')).toHaveTextContent('verified');
    expect(container.querySelector('ul ul')).toHaveTextContent('Nested');
    expect(container.querySelector('ol')).toHaveTextContent('Ordered');
    expect(container.querySelector('blockquote')).toHaveTextContent('A note');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('preserves left, center, and right alignment in GFM tables', () => {
    render(
      <MessageMarkdown
        content={'| Left | Center | Right |\n| :--- | :---: | ---: |\n| One | Two | 42 |'}
      />,
    );
    expect(screen.getByRole('cell', { name: 'One' })).toHaveStyle({ textAlign: 'left' });
    expect(screen.getByRole('cell', { name: 'Two' })).toHaveStyle({ textAlign: 'center' });
    expect(screen.getByRole('cell', { name: '42' })).toHaveStyle({ textAlign: 'right' });
    expect(screen.getByRole('region', { name: 'Table' })).toHaveAttribute('tabindex', '0');
  });

  it('shows language and syntax colors while copying the exact fenced code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const source = 'const html = "<strong>literal</strong>";\n  return 42;';
    const { container } = render(
      <MessageMarkdown content={`\`\`\`typescript\n${source}\n\`\`\``} />,
    );
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(container.querySelector('pre span')).not.toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(source);
    vi.unstubAllGlobals();
  });

  it('keeps unclosed streaming fences readable and handles unlabeled code', () => {
    const { container, rerender } = render(
      <MessageMarkdown content={'```python\nprint("hello")'} />,
    );
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe('print("hello")');
    rerender(<MessageMarkdown content={'```\nplain code\n```\n\nUse `inline()`.'} />);
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(container.querySelector('p code')).toHaveTextContent('inline()');
  });

  it('renders raw HTML literally and rejects executable URLs without fetching images', () => {
    const { container } = render(
      <MessageMarkdown
        content={
          '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Unsafe](javascript:alert%281%29)\n\n![Untrusted](https://example.com/image.png)'
        }
      />,
    );
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull();
    const imageLink = screen.getByRole('link', { name: 'Image: Untrusted' });
    expect(imageLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(imageLink).toHaveAttribute('href', 'https://example.com/image.png');
  });

  it('drops ANSI and terminal-control payloads before parsing Markdown', () => {
    render(<MessageMarkdown content={'\x1b[32m**Completed**\x1b[0m\x1b]52;c;hidden\x07'} />);
    expect(screen.getByText('Completed').tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('hidden');
    expect(document.body.textContent).not.toContain('\x1b');
  });

  it('lets users retry a rejected clipboard write without reporting success', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<MessageMarkdown content={'```\nhello\n```'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copy failed · Retry')).toBeInTheDocument());
    expect(screen.queryByText('Copied')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
