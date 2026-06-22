import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecretReveal from './SecretReveal';

const SECRET = `mwt_${'A'.repeat(39)}`;

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    // jsdom may not ship clipboard at all; remove our stub.
    // biome-ignore lint/performance/noDelete: needed to restore the absent property
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

function installClipboard(writeText: (value: string) => Promise<void>): {
  writeText: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(writeText);
  // jsdom 26 ships navigator.clipboard as a non-configurable own
  // accessor; redefining the property fails on some hosts. We
  // instead install/replace the property at the instance level by
  // first marking it configurable.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { writeText: spy },
  });
  return { writeText: spy };
}

describe('SecretReveal', () => {
  it('renders the masked bullet string by default; secret is not in DOM', () => {
    render(<SecretReveal secret={SECRET} />);
    const node = screen.getByTestId('secret-reveal-value');
    expect(node.textContent).toBe('•'.repeat(SECRET.length));
    expect(node.textContent).not.toContain(SECRET);
  });

  it('Reveal button toggles plaintext, button label changes to Hide', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SecretReveal secret={SECRET} />);
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe(SECRET);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('Copy reveals briefly, calls onCopy, then auto-restores mask after revealRestoreMs', async () => {
    // userEvent.setup() installs its own fake clipboard, so install ours after.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { writeText } = installClipboard(() => Promise.resolve());
    const onCopy = vi.fn();
    render(<SecretReveal secret={SECRET} onCopy={onCopy} revealRestoreMs={2000} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe(SECRET);
    expect(screen.getByTestId('secret-reveal-feedback').textContent).toBe('Copied');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe('•'.repeat(SECRET.length));
  });

  it('Copy failure stays masked, does NOT call onCopy, and surfaces a Copy failed hint', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    installClipboard(() => Promise.reject(new Error('denied')));
    const onCopy = vi.fn();
    render(<SecretReveal secret={SECRET} onCopy={onCopy} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe('•'.repeat(SECRET.length));
    expect(screen.getByTestId('secret-reveal-feedback').textContent).toBe('Copy failed');
  });

  it('visibilitychange to hidden forces mask back on', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SecretReveal secret={SECRET} />);
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe(SECRET);
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe('•'.repeat(SECRET.length));
  });

  it('initiallyMasked=false starts with plaintext visible', () => {
    render(<SecretReveal secret={SECRET} initiallyMasked={false} />);
    expect(screen.getByTestId('secret-reveal-value').textContent).toBe(SECRET);
  });
});
