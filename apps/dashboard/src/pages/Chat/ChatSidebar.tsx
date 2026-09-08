import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chatStatusLabel, displayLabel } from '@/lib/labels';
import type { ChatViewModel } from '@/viewmodels/useChatViewModel';
import { ChatInbox } from '@nocoo/basalt/components/chat-inbox';
import { ArrowUpRight, History, Search, SquarePen } from 'lucide-react';
import { Link } from 'react-router';

export default function ChatSidebar({ vm, onNavigate }: { vm: ChatViewModel; onNavigate(): void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4 px-3 pt-5 pb-3">
        <p className="px-2 text-xs font-medium text-basalt-muted-foreground">Conversations</p>
        <Button
          variant="outline"
          className="h-10 w-full justify-start gap-2.5 rounded-xl bg-basalt-control/50 px-3 shadow-none"
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
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-9 rounded-xl border-basalt-border/60 bg-transparent pl-9 text-xs shadow-none"
          />
        </div>
      </div>
      <ChatInbox
        aria-label="Conversations"
        className="chat-inbox flex-1 px-2"
        activeId={vm.activeConversationId ?? ''}
        onSelect={(id) => {
          vm.selectConversation(id);
          onNavigate();
        }}
        items={vm.conversations.map((item) => ({
          id: item.id,
          title: item.title,
          preview: `${displayLabel(item.agent)} · ${chatStatusLabel(item.status)}`,
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
            <span className="flex items-center gap-2">
              <History className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Saved runs
            </span>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
