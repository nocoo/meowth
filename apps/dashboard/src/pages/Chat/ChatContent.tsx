import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { displayLabel } from '@/lib/labels';
import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nocoo/basalt';
import { ChatComposer } from '@nocoo/basalt/components/chat-composer';
import { ChatHeader } from '@nocoo/basalt/components/chat-header';
import { ArrowDown, Bot, MessagesSquare, SquarePen } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import AgentPicker from './AgentPicker';
import ChatSidebar from './ChatSidebar';
import MessageList from './MessageList';

export interface ChatContentProps {
  vm: ChatViewModel;
}

export default function ChatContent({ vm }: ChatContentProps) {
  const compact = useIsMobile(1100);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const inboxTrigger = useRef<HTMLButtonElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const streaming = vm.turns.at(-1)?.status === 'streaming';
  const agentName = vm.selectedAgent ? displayLabel(vm.selectedAgent) : 'Assistant';

  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing conversations resets scroll ownership.
  useLayoutEffect(() => {
    following.current = true;
    setShowLatest(false);
  }, [vm.activeConversationId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: New content only follows when the reader is already at the bottom.
  useLayoutEffect(() => {
    if (following.current && scrollArea.current)
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [vm.turns]);

  if (vm.agentsStatus.kind !== 'ready') return null;
  const installed = vm.agentsStatus.agents.filter((agent) => agent.installed);
  if (installed.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Bot}
          title="No agents installed"
          description="Connect a local coding agent to start a conversation."
          action={
            <Button asChild size="xs" variant="outline">
              <Link to="/agents">View agents</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1" data-slot="chat-shell">
      {compact ? (
        <Sheet open={inboxOpen} onOpenChange={setInboxOpen}>
          <SheetContent
            side="left"
            className="w-72 max-w-[85vw] p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              inboxTrigger.current?.focus();
            }}
          >
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            <SheetDescription className="sr-only">
              Search, switch, or start a conversation
            </SheetDescription>
            <ChatSidebar vm={vm} onNavigate={() => setInboxOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          className="w-60 shrink-0 border-r border-basalt-border/60 bg-basalt-secondary/30"
          aria-label="Chat workspace"
        >
          <ChatSidebar vm={vm} onNavigate={() => undefined} />
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          className="shrink-0 gap-3 px-4 py-3 sm:px-6"
          title={vm.turns[0]?.userPrompt ?? 'New conversation'}
          subtitle={`${agentName} · ${streaming ? 'Responding' : 'Ready'}`}
          leading={
            compact ? (
              <Button
                ref={inboxTrigger}
                variant="ghost"
                size="icon-sm"
                aria-label="Show conversations"
                onClick={() => setInboxOpen(true)}
              >
                <MessagesSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </Button>
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-basalt-widget bg-basalt-primary/10 text-basalt-primary">
                <Bot className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </span>
            )
          }
        >
          <AgentPicker
            agents={vm.agentsStatus.agents}
            selectedAgent={vm.selectedAgent}
            onChange={vm.setSelectedAgent}
          />
          {compact ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              title="New chat"
              onClick={vm.newChat}
            >
              <SquarePen className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          ) : null}
        </ChatHeader>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollArea}
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={streaming}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"
            data-slot="chat-message-area"
            onScroll={(event) => {
              const element = event.currentTarget;
              following.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 64;
              setShowLatest(!following.current);
            }}
          >
            <div
              className="mx-auto flex min-h-full w-full max-w-3xl flex-col py-6 sm:py-8"
              data-slot="chat-column"
            >
              <MessageList turns={vm.turns} agentName={agentName} onRetry={vm.retry} />
            </div>
          </div>
          {showLatest ? (
            <Button
              variant="outline"
              size="xs"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-sm"
              onClick={() => {
                following.current = true;
                setShowLatest(false);
                scrollArea.current?.scrollTo({
                  top: scrollArea.current.scrollHeight,
                  behavior: 'instant',
                });
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Jump to latest
            </Button>
          ) : null}
        </div>
        <footer className="shrink-0 px-4 pt-2 pb-4 sm:px-6 sm:pb-5">
          <div className="mx-auto w-full max-w-3xl" data-slot="chat-column">
            <ChatComposer
              key={vm.activeConversationId}
              label="Message"
              placeholder={`Message ${agentName}…`}
              sendLabel="Send"
              cancelLabel="Stop"
              streaming={streaming}
              disabled={!vm.composer.canSend && !streaming}
              onSend={vm.composer.submit}
              onCancel={vm.composer.cancel}
              className="border-0 bg-transparent p-0 [&>div]:bg-basalt-control [&>div]:shadow-sm [&>div]:focus-within:ring-basalt-ring/50"
            />
            <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-basalt-muted-foreground">
              <span>Enter to send · Shift+Enter for a new line</span>
              <span className="hidden shrink-0 sm:inline">{installed.length} agents available</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
