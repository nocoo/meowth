import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import RefreshButton from './refresh-button';
import { RefreshProvider } from './refresh-context';
import { useRegisterRefresh } from './use-register-refresh';

function Harness({ children }: { children: ReactNode }) {
  return <RefreshProvider>{children}</RefreshProvider>;
}

function RegisterOnMount({ handler }: { handler: () => void | Promise<void> }) {
  useRegisterRefresh(handler);
  return null;
}

describe('RefreshButton', () => {
  it('renders nothing when no handler is registered', () => {
    const { container } = render(
      <Harness>
        <RefreshButton />
      </Harness>,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders the button once a handler is registered', () => {
    render(
      <Harness>
        <RegisterOnMount handler={() => undefined} />
        <RefreshButton />
      </Harness>,
    );
    expect(screen.getByRole('button', { name: /refresh page data/i })).toBeInTheDocument();
  });

  it('clicking invokes the handler', async () => {
    const handler = vi.fn();
    render(
      <Harness>
        <RegisterOnMount handler={handler} />
        <RefreshButton />
      </Harness>,
    );
    await userEvent.click(screen.getByRole('button', { name: /refresh page data/i }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('shows pending state and disables while async handler in flight', async () => {
    let resolveHandler: () => void = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    );
    render(
      <Harness>
        <RegisterOnMount handler={handler} />
        <RefreshButton />
      </Harness>,
    );
    const button = screen.getByRole('button', { name: /refresh page data/i });
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: /refreshing/i })).toBeDisabled();
    await act(async () => {
      resolveHandler();
    });
    expect(screen.getByRole('button', { name: /refresh page data/i })).not.toBeDisabled();
  });

  it('unregister hides the button when the registering component unmounts', () => {
    function Toggle({ mounted }: { mounted: boolean }) {
      return (
        <Harness>
          {mounted && <RegisterOnMount handler={() => undefined} />}
          <RefreshButton />
        </Harness>
      );
    }
    const { container, rerender } = render(<Toggle mounted={true} />);
    expect(container.querySelector('button')).not.toBeNull();
    rerender(<Toggle mounted={false} />);
    expect(container.querySelector('button')).toBeNull();
  });
});
