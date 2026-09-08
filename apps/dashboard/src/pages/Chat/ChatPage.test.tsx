import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// useChatViewModel is mocked so we can drive ChatPage through
// each agentsStatus branch deterministically.

const vmRef = { current: null as ChatViewModel | null };

vi.mock('@/viewmodels/useChatViewModel', () => ({
  default: () => vmRef.current as ChatViewModel,
}));

// Import after mocks are wired so the page picks up the mocked
// modules. dynamic import keeps the linter from reordering.
async function loadChatPage() {
  const mod = await import('./ChatPage');
  return mod.default;
}

function makeVM(over: Partial<ChatViewModel>): ChatViewModel {
  return {
    agentsStatus: { kind: 'loading' },
    selectedAgent: null,
    setSelectedAgent: vi.fn(),
    conversations: [],
    activeConversationId: null,
    selectConversation: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    turns: [],
    resumeSessionId: null,
    composer: {
      canSend: false,
      submit: vi.fn(),
      cancel: vi.fn(),
    },
    newChat: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vmRef.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatPage', () => {
  it('loading → renders ChatSkeleton', async () => {
    vmRef.current = makeVM({ agentsStatus: { kind: 'loading' } });
    const ChatPage = await loadChatPage();
    const { container } = render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-slot="chat-skeleton"]')).not.toBeNull();
  });

  it('error → renders the EmptyState with the daemon message', async () => {
    vmRef.current = makeVM({
      agentsStatus: { kind: 'error', message: 'Daemon unreachable.' },
    });
    const ChatPage = await loadChatPage();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Chat unavailable')).toBeInTheDocument();
    expect(screen.getByText('Daemon unreachable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(vmRef.current.refresh).toHaveBeenCalledTimes(1);
  });

  it('ready → renders ChatContent', async () => {
    vmRef.current = makeVM({
      agentsStatus: {
        kind: 'ready',
        agents: [
          { type: 'claude', installed: true, executable: '/usr/bin/claude', version: '1.0' },
        ],
      },
      selectedAgent: 'claude',
      composer: {
        canSend: false,
        submit: vi.fn(),
        cancel: vi.fn(),
      },
    });
    const ChatPage = await loadChatPage();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Backend agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});
