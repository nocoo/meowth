import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { EmptyState } from '@/components/ui/empty-state';
import useChatViewModel from '@/viewmodels/useChatViewModel';
import { AlertCircle } from 'lucide-react';
import { useCallback } from 'react';
import ChatContent from './ChatContent';
import ChatSkeleton from './ChatSkeleton';

// docs/features/03 §4.3 — Page shell. Mirrors AgentsPage /
// OverviewPage exactly. Owns the viewmodel + three-state branch.
//
// The header refresh button is wired to `reset() + refresh()` per
// §4.3 "新会话" semantics: reset aborts an in-flight stream and
// clears turns/resumeSessionId; refresh re-pulls /v1/agents. With
// only `refresh()` the user would land back in the same chat
// session, defeating the "new session" intent.

export default function ChatPage() {
  const vm = useChatViewModel();
  const handleHeaderRefresh = useCallback(() => {
    vm.reset();
    vm.refresh();
  }, [vm.reset, vm.refresh]);
  useRegisterRefresh(handleHeaderRefresh);

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
