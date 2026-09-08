import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import useChatViewModel from '@/viewmodels/useChatViewModel';
import { AlertCircle } from 'lucide-react';
import ChatContent from './ChatContent';
import ChatSkeleton from './ChatSkeleton';

export default function ChatPage() {
  const vm = useChatViewModel();

  return (
    <section
      aria-labelledby="chat-heading"
      className="flex h-full min-h-0 flex-1 flex-col"
      data-slot="chat-page"
    >
      <h2 id="chat-heading" className="sr-only">
        Chat
      </h2>
      {vm.agentsStatus.kind === 'loading' ? (
        <ChatSkeleton />
      ) : vm.agentsStatus.kind === 'error' ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState
            icon={AlertCircle}
            title="Chat unavailable"
            description={vm.agentsStatus.message}
            tone="error"
            action={
              <Button size="xs" variant="outline" onClick={vm.refresh}>
                Retry connection
              </Button>
            }
          />
        </div>
      ) : (
        <ChatContent vm={vm} />
      )}
    </section>
  );
}
