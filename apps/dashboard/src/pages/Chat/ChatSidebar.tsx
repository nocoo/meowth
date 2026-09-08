import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chatStatusLabel, displayLabel } from '@/lib/labels';
import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { ChatInbox } from '@nocoo/basalt/components/chat-inbox';
import { ArrowUpRight, MessageSquare, Search, SquarePen } from 'lucide-react';
import { Link } from 'react-router';

export default function ChatSidebar({ vm, onNavigate }: { vm: ChatViewModel; onNavigate(): void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4 px-4 pt-5 pb-3">
        <p className="text-sm font-semibold tracking-tight">Conversations</p>
        <Button
          className="w-full justify-start gap-2"
          size="xs"
          onClick={() => {
            vm.newChat();
            onNavigate();
          }}
        >
          <SquarePen className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          New chat
        </Button>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-basalt-muted-foreground"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <Input
            value={vm.search}
            onChange={(event) => vm.setSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 pl-9 text-xs"
          />
        </div>
      </div>
      <ChatInbox
        aria-label="Conversations"
        className="flex-1 px-2"
        activeId={vm.activeConversationId ?? ''}
        onSelect={(id) => {
          vm.selectConversation(id);
          onNavigate();
        }}
        items={vm.conversations.map((item) => ({
          id: item.id,
          title: item.title,
          preview: `${displayLabel(item.agent)} · ${chatStatusLabel(item.status)}`,
          leading: (
            <MessageSquare
              className="h-4 w-4 text-basalt-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          ),
        }))}
      />
      {vm.conversations.length === 0 ? (
        <p className="px-5 pb-5 text-xs leading-5 text-basalt-muted-foreground">
          {vm.search ? 'No conversations found.' : 'Your conversations will appear here.'}
        </p>
      ) : null}
      <div className="border-t border-basalt-border/60 p-3">
        <Button
          asChild
          variant="ghost"
          size="xs"
          className="w-full justify-between text-basalt-muted-foreground"
        >
          <Link to="/sessions">
            View saved runs
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
