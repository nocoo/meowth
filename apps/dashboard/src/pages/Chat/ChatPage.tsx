import { Button } from '@nocoo/basalt/components/button';
import { AlertCircle } from '@nocoo/basalt/icons';
import { EmptyState } from '@/components/EmptyState';
import useChatViewModel from '@/viewmodels/useChatViewModel';
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
              <Button size="sm" variant="outline" onClick={vm.refresh}>
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
