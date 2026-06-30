import type { ChatTurn } from '@/models/chat';
import type { ChatAgentsStatus, ChatViewModel } from '@/viewmodels/useChatViewModel';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import ChatContent from './ChatContent';

function makeVM(over: Partial<ChatViewModel> = {}): ChatViewModel {
  const status: ChatAgentsStatus = over.agentsStatus ?? {
    kind: 'ready',
    agents: [{ type: 'claude', installed: true, executable: '/usr/bin/claude', version: '1.0' }],
  };
  return {
    agentsStatus: status,
    selectedAgent: 'claude',
    setSelectedAgent: vi.fn(),
    turns: [],
    resumeSessionId: null,
    composer: {
      input: '',
      setInput: vi.fn(),
      canSend: true,
      submit: vi.fn(),
      cancel: vi.fn(),
    },
    reset: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function streamingTurn(): ChatTurn {
  return {
    sessionId: 'sid-1',
    backendSessionId: null,
    userPrompt: 'hi',
    envelopes: [],
    status: 'streaming',
    startedAt: '2026-06-30T07:00:00Z',
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

describe('ChatContent', () => {
  it('zero installed agents → renders "No agents installed" empty state', () => {
    const vm = makeVM({
      agentsStatus: {
        kind: 'ready',
        agents: [{ type: 'pi', installed: false, executable: '', version: '' }],
      },
      selectedAgent: null,
    });
    renderContent(vm);
    expect(screen.getByText('No agents installed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Backend agent')).toBeNull();
  });

  it('ready with empty turns → picker + empty hint + composer Send button', () => {
    const vm = makeVM();
    renderContent(vm);
    expect(screen.getByLabelText('Backend agent')).toBeInTheDocument();
    expect(screen.getByText('Start a conversation.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('ready with a streaming turn → Composer flips to Cancel + Textarea disabled', () => {
    const vm = makeVM({
      turns: [streamingTurn()],
      composer: {
        input: '',
        setInput: vi.fn(),
        canSend: false,
        submit: vi.fn(),
        cancel: vi.fn(),
      },
    });
    renderContent(vm);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('ready + completed turn + canSend=false → Send is disabled (input empty)', () => {
    const completedTurn: ChatTurn = {
      ...streamingTurn(),
      status: 'completed',
      endedAt: '2026-06-30T07:00:05Z',
    };
    const vm = makeVM({
      turns: [completedTurn],
      composer: {
        input: '',
        setInput: vi.fn(),
        canSend: false,
        submit: vi.fn(),
        cancel: vi.fn(),
      },
    });
    renderContent(vm);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('non-ready vm (defensive null) → renders nothing', () => {
    const vm = makeVM({ agentsStatus: { kind: 'loading' } });
    const { container } = renderContent(vm);
    expect(container).toBeEmptyDOMElement();
  });
});
