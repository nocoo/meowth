import type { ChatComposer as ChatComposerVM } from '@/viewmodels/useChatViewModel';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';

function makeComposer(overrides: Partial<ChatComposerVM> = {}): ChatComposerVM {
  return {
    input: '',
    setInput: vi.fn(),
    canSend: true,
    submit: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe('ChatComposer', () => {
  it('non-streaming + canSend=true → Send is enabled and click triggers submit', () => {
    const submit = vi.fn();
    const composer = makeComposer({ input: 'hi', canSend: true, submit });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('non-streaming + canSend=false → Send is disabled and form submit does not call submit', () => {
    const submit = vi.fn();
    const composer = makeComposer({ input: '', canSend: false, submit });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    // Even if a form somehow submits (e.g. programmatic), guard rejects.
    fireEvent.submit(send.closest('form') as HTMLFormElement);
    expect(submit).not.toHaveBeenCalled();
  });

  it('streaming → button reads Cancel and click triggers cancel', () => {
    const cancel = vi.fn();
    const composer = makeComposer({ canSend: false, cancel });
    render(<ChatComposer composer={composer} isStreaming />);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(btn);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('streaming → Textarea is disabled', () => {
    const composer = makeComposer({ canSend: false });
    render(<ChatComposer composer={composer} isStreaming />);
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('Textarea onChange forwards to composer.setInput', () => {
    const setInput = vi.fn();
    const composer = makeComposer({ input: '', setInput });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    expect(setInput).toHaveBeenCalledWith('hello');
  });

  it('Enter (no shift) + canSend=true → submit is invoked once', () => {
    const submit = vi.fn();
    const composer = makeComposer({ input: 'hi', canSend: true, submit });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('Enter (no shift) + canSend=false → submit is NOT invoked (component-layer guard)', () => {
    const submit = vi.fn();
    const composer = makeComposer({ input: '', canSend: false, submit });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('Shift+Enter does not submit (newline allowed)', () => {
    const submit = vi.fn();
    const composer = makeComposer({ input: 'hi', canSend: true, submit });
    render(<ChatComposer composer={composer} isStreaming={false} />);
    fireEvent.keyDown(screen.getByLabelText('Message'), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
