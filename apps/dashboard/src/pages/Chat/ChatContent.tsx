import { EmptyState } from '@/components/ui/empty-state';
import type { ChatTurn } from '@/viewmodels/useChatViewModel';
import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { Bot, SquarePen } from 'lucide-react';
import AgentPicker from './AgentPicker';
import ChatComposer from './ChatComposer';
import MessageList from './MessageList';

// docs/features/03 §4.3 + §4.4 — pure-props Content. Receives the
// full ChatViewModel and renders the picker / list / composer
// layout. The Page owns the three-state branch; Content defends
// against a non-ready vm only as a TS-narrow safety net.

export interface ChatContentProps {
  vm: ChatViewModel;
}

function isLastTurnStreaming(turns: readonly ChatTurn[]): boolean {
  return turns.length > 0 && turns[turns.length - 1]?.status === 'streaming';
}

export default function ChatContent({ vm }: ChatContentProps) {
  // Safety net only — ChatPage routes loading/error to skeleton /
  // EmptyState, so reaching ChatContent with a non-ready status is
  // a programming error. Returning null keeps the surface clean
  // without throwing.
  if (vm.agentsStatus.kind !== 'ready') return null;

  const installed = vm.agentsStatus.agents.filter((a) => a.installed);
  if (installed.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <EmptyState
          icon={Bot}
          title="No agents installed"
          description="No backends are installed locally. Install at least one CLI (claude / copilot / codex / hermes / pi) — see the Agents page for status."
        />
      </div>
    );
  }

  const streaming = isLastTurnStreaming(vm.turns);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-slot="chat-shell">
      <header className="flex shrink-0 justify-center border-b border-basalt-border/60 px-4 py-3">
        <div
          className="flex w-full max-w-3xl items-center justify-between gap-3"
          data-slot="chat-column"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-basalt-muted-foreground">Agent</span>
            <AgentPicker
              agents={vm.agentsStatus.agents}
              selectedAgent={vm.selectedAgent}
              onChange={vm.setSelectedAgent}
            />
          </div>
          <Button
            variant="ghost"
            size="xs"
            aria-label="New chat"
            title="New chat"
            disabled={vm.turns.length === 0}
            onClick={vm.reset}
          >
            <SquarePen className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4" data-slot="chat-message-area">
        <div
          className="mx-auto flex min-h-full w-full max-w-3xl flex-col py-6"
          data-slot="chat-column"
        >
          <MessageList turns={vm.turns} />
        </div>
      </div>
      <footer className="flex shrink-0 justify-center px-4 pt-1 pb-4">
        <div className="w-full max-w-3xl" data-slot="chat-column">
          <ChatComposer composer={vm.composer} isStreaming={streaming} />
        </div>
      </footer>
    </div>
  );
}
import { Button } from '@/components/ui/button';
