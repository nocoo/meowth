import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyButton from './CopyButton';

function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it('copies the text and reports the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton text="hello" label="Copy code" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports a failed copy and retries on the next click', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    stubClipboard(writeText);
    render(<CopyButton text="hello" label="Copy code" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copy failed · Retry')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('resets the copied state after the feedback window', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton text="hello" label="Copy response" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    await vi.waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());

    vi.advanceTimersByTime(2600);
    await vi.waitFor(() => expect(screen.getByText('Copy response')).toBeInTheDocument());
    vi.useRealTimers();
  });

  it('keeps the feedback out of the button title when the label is visible', () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton text="hello" label="Copy response" iconOnly />);

    const button = screen.getByRole('button', { name: 'Copy response' });
    expect(button).toHaveAttribute('title', 'Copy response');
    expect(screen.getByText('Copy response')).toHaveClass('sr-only');
  });
});
