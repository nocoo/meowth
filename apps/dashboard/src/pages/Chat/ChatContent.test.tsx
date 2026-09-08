import type { ChatTurn, ChatViewModel } from '@/viewmodels/useChatViewModel';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContent from './ChatContent';

function makeVM(over: Partial<ChatViewModel> = {}): ChatViewModel {
  return {
    agentsStatus: {
      kind: 'ready',
      agents: [{ type: 'claude', installed: true, executable: '/usr/bin/claude', version: '1.0' }],
    },
    selectedAgent: 'claude',
    setSelectedAgent: vi.fn(),
    conversations: [],
    activeConversationId: 'conversation-1',
    selectConversation: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    turns: [],
    resumeSessionId: null,
    composer: { canSend: true, submit: vi.fn(), cancel: vi.fn() },
    newChat: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function streamingTurn(): ChatTurn {
  return {
    id: 'turn-1',
    sessionId: 'sid-1',
    backendSessionId: null,
    userPrompt: 'Hello',
    envelopes: [],
    status: 'streaming',
    startedAt: '2026-09-08T08:00:00Z',
    endedAt: null,
  };
}

function renderContent(vm: ChatViewModel) {
  return render(
    <MemoryRouter>
      <ChatContent vm={vm} />
    </MemoryRouter>,
  );
}

const originalWidth = window.innerWidth;
beforeEach(() => {
  window.innerWidth = 1440;
});
afterEach(() => {
  window.innerWidth = originalWidth;
  vi.restoreAllMocks();
});

describe('Chat workspace', () => {
  it('links to agent setup when no agents are installed', () => {
    renderContent(makeVM({ agentsStatus: { kind: 'ready', agents: [] }, selectedAgent: null }));
    expect(screen.getByText('No agents installed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View agents' })).toHaveAttribute('href', '/agents');
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('shows the inbox, conversation header, and template composer', () => {
    renderContent(makeVM());
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose agent')).toBeInTheDocument();
    expect(screen.getByText('What can we work on?')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });

  it('wires new chat, search, and conversation selection to the workspace', () => {
    const vm = makeVM({
      conversations: [
        {
          id: 'older',
          agent: 'claude',
          title: 'Previous question',
          status: 'completed',
          updatedAt: '2026-09-08',
          turnCount: 1,
        },
      ],
    });
    renderContent(vm);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(vm.newChat).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), {
      target: { value: 'Previous' },
    });
    expect(vm.setSearch).toHaveBeenCalledWith('Previous');
    fireEvent.click(screen.getByRole('button', { name: /Previous question/ }));
    expect(vm.selectConversation).toHaveBeenCalledWith('older');
  });

  it('shows a searchable conversation drawer on compact screens', () => {
    window.innerWidth = 390;
    renderContent(makeVM({ search: 'missing' }));
    expect(screen.queryByRole('navigation', { name: 'Conversations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('textbox', { name: 'Search conversations' })).toHaveValue(
      'missing',
    );
    expect(within(drawer).getByText('No conversations found.')).toBeInTheDocument();
  });

  it('collapses the desktop conversation list without losing an unsent draft', () => {
    renderContent(makeVM());
    const field = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(field, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide conversations' }));
    expect(screen.queryByRole('navigation', { name: 'Conversations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeVisible();
    expect(field).toHaveValue('Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }));
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
    expect(field).toHaveValue('Keep this draft');
  });

  it('hides controls until availability has loaded', () => {
    const { container } = renderContent(makeVM({ agentsStatus: { kind: 'loading' } }));
    expect(container).toBeEmptyDOMElement();
  });

  it('preserves the reader position until Jump to latest or a conversation switch', () => {
    const vm = makeVM({ turns: [streamingTurn()] });
    const { rerender } = renderContent(vm);
    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
    });
    const scrollTo = vi.fn();
    log.scrollTo = scrollTo;
    fireEvent.scroll(log, { target: { scrollTop: 100 } });
    rerender(
      <MemoryRouter>
        <ChatContent vm={{ ...vm, turns: [...vm.turns] }} />
      </MemoryRouter>,
    );
    expect(log.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'instant' });
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    fireEvent.scroll(log, { target: { scrollTop: 800 } });
    rerender(
      <MemoryRouter>
        <ChatContent vm={{ ...vm, turns: [...vm.turns] }} />
      </MemoryRouter>,
    );
    expect(log.scrollTop).toBe(1200);
    fireEvent.scroll(log, { target: { scrollTop: 200 } });
    rerender(
      <MemoryRouter>
        <ChatContent vm={{ ...vm, activeConversationId: 'other', turns: [] }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    expect(log.scrollTop).toBe(1200);
  });
});

describe('Basalt composer integration', () => {
  it('sends trimmed text with Enter and clears the draft', () => {
    const vm = makeVM();
    renderContent(vm);
    const field = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(field, { target: { value: '  Hello\nworld  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(vm.composer.submit).toHaveBeenCalledWith('Hello\nworld');
    expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('ignores whitespace, Shift+Enter, and Enter during IME composition', () => {
    const vm = makeVM();
    renderContent(vm);
    const field = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(field, { target: { value: ' \n ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: '你好' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(vm.composer.submit).not.toHaveBeenCalled();
    expect(field).toHaveValue('你好');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(vm.composer.submit).toHaveBeenCalledWith('你好');
  });

  it('allows drafting the next message while streaming and wires Stop', () => {
    const vm = makeVM({ turns: [streamingTurn()] });
    renderContent(vm);
    const field = screen.getByRole('textbox', { name: 'Message' });
    expect(field).toBeEnabled();
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    fireEvent.change(field, { target: { value: 'Next question' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(vm.composer.submit).not.toHaveBeenCalled();
    expect(field).toHaveValue('Next question');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(vm.composer.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('disables sending when the selected agent is unavailable', () => {
    const vm = makeVM();
    vm.composer.canSend = false;
    renderContent(vm);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
