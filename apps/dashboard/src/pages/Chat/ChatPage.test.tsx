import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Both upstream hooks are mocked so we can:
//   - drive ChatPage through each agentsStatus branch deterministically
//   - capture the handler ChatPage registers with useRegisterRefresh
//     and verify it triggers BOTH reset() AND refresh() per §4.3.
//
// The vi.mock calls are hoisted, so the captured registrations are
// reset in beforeEach to keep cases isolated.

const vmRef = { current: null as ChatViewModel | null };
const registeredHandlers: Array<() => void | Promise<void>> = [];

vi.mock('@/viewmodels/useChatViewModel', () => ({
  default: () => vmRef.current as ChatViewModel,
}));

vi.mock('@/components/layout/use-register-refresh', () => ({
  useRegisterRefresh: (handler: () => void | Promise<void>) => {
    registeredHandlers.push(handler);
  },
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
    turns: [],
    resumeSessionId: null,
    composer: {
      input: '',
      setInput: vi.fn(),
      canSend: false,
      submit: vi.fn(),
      cancel: vi.fn(),
    },
    reset: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  registeredHandlers.length = 0;
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
        input: '',
        setInput: vi.fn(),
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

  it('header refresh handler triggers BOTH vm.reset() and vm.refresh() per §4.3', async () => {
    const reset = vi.fn();
    const refresh = vi.fn();
    vmRef.current = makeVM({
      agentsStatus: {
        kind: 'ready',
        agents: [
          { type: 'claude', installed: true, executable: '/usr/bin/claude', version: '1.0' },
        ],
      },
      selectedAgent: 'claude',
      reset,
      refresh,
    });
    const ChatPage = await loadChatPage();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(registeredHandlers.length).toBeGreaterThan(0);
    const handler = registeredHandlers[registeredHandlers.length - 1];
    handler?.();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
