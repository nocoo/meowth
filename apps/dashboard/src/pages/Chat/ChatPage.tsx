import { EmptyState } from '@/components/ui/empty-state';
import useChatViewModel from '@/viewmodels/useChatViewModel';
import { AlertCircle } from 'lucide-react';
import ChatContent from './ChatContent';
import ChatSkeleton from './ChatSkeleton';

// docs/features/03 §4.3 — Page shell. Owns the viewmodel +
// three-state branch. Chat does not register the AppShell refresh
// button: a header rotate-cw that wipes the live thread reads as
// a page reload, not a new session.

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
          />
        </div>
      ) : (
        <ChatContent vm={vm} />
      )}
    </section>
  );
}
