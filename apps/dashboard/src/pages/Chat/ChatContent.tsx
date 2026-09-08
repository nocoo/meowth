import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { displayLabel } from '@/lib/labels';
import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nocoo/basalt';
import { ChatComposer } from '@nocoo/basalt/components/chat-composer';
import { ChatHeader } from '@nocoo/basalt/components/chat-header';
import { ArrowDown, Bot, CornerDownLeft, PanelLeft, SquarePen } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import AgentPicker from './AgentPicker';
import ChatSidebar from './ChatSidebar';
import MessageList from './MessageList';
import './chat.css';

export interface ChatContentProps {
  vm: ChatViewModel;
}

export default function ChatContent({ vm }: ChatContentProps) {
  const compact = useIsMobile(1100);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showLatest, setShowLatest] = useState(false);
  const inboxTrigger = useRef<HTMLButtonElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const streaming = vm.turns.at(-1)?.status === 'streaming';
  const empty = vm.turns.length === 0;
  const showSidebar = !compact && sidebarOpen;
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
    <div className="chat-workspace flex h-full min-h-0 flex-1" data-slot="chat-shell">
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
      ) : showSidebar ? (
        <aside
          id="chat-conversations"
          className="chat-sidebar w-56 shrink-0 border-r border-basalt-border/50"
          aria-label="Chat workspace"
        >
          <ChatSidebar vm={vm} onNavigate={() => undefined} />
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          className="chat-header"
          title={
            <AgentPicker
              agents={vm.agentsStatus.agents}
              selectedAgent={vm.selectedAgent}
              onChange={vm.setSelectedAgent}
              hasMessages={!empty}
            />
          }
          leading={
            <Button
              ref={inboxTrigger}
              variant="ghost"
              size="icon-sm"
              aria-label={showSidebar ? 'Hide conversations' : 'Show conversations'}
              aria-expanded={compact ? inboxOpen : sidebarOpen}
              aria-controls={showSidebar ? 'chat-conversations' : undefined}
              title={showSidebar ? 'Hide conversations' : 'Show conversations'}
              className="text-basalt-muted-foreground"
              onClick={() => (compact ? setInboxOpen(true) : setSidebarOpen((open) => !open))}
            >
              <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          }
        >
          <span className="hidden items-center gap-1.5 px-2 text-xs text-basalt-muted-foreground sm:inline-flex">
            {streaming ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-basalt-primary motion-reduce:animate-none" />
            ) : null}
            {streaming ? 'Responding' : 'Ready'}
          </span>
          {!showSidebar ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              title="New chat"
              className="text-basalt-muted-foreground"
              onClick={vm.newChat}
            >
              <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          ) : null}
        </ChatHeader>
        <div className="chat-main relative flex min-h-0 flex-1 flex-col" data-empty={empty}>
          <div className="chat-reader relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollArea}
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={streaming}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8"
              data-slot="chat-message-area"
              onScroll={(event) => {
                const element = event.currentTarget;
                following.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 64;
                setShowLatest(!following.current);
              }}
            >
              <div
                className="chat-reading-column mx-auto w-full py-6 sm:py-8"
                data-slot="chat-column"
              >
                <MessageList turns={vm.turns} agentName={agentName} onRetry={vm.retry} />
              </div>
            </div>
            {showLatest ? (
              <Button
                variant="outline"
                size="xs"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-basalt-card px-3 shadow-sm"
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
          <footer className="chat-footer shrink-0 px-4 pt-2 pb-3 sm:px-8 sm:pb-4">
            <div className="chat-reading-column mx-auto w-full" data-slot="chat-column">
              <div className="relative">
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
                  className="chat-composer"
                />
                <span className="chat-composer-hint" aria-hidden="true">
                  <CornerDownLeft className="h-3 w-3" strokeWidth={1.5} />
                  Enter to send
                  <span className="hidden sm:inline">· Shift+Enter for a new line</span>
                </span>
              </div>
              <p className="mt-3 text-center text-[11px] text-basalt-muted-foreground">
                {empty
                  ? 'Code, ideas, and everything in between.'
                  : `${agentName} · Follow-up messages keep the conversation in context.`}
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
