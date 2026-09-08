import MessageText from '@/components/MessageText';
import AgentResponse from '@/components/chat/AgentResponse';
import type { ChatTurn } from '@/viewmodels/useChatViewModel';
import { ChatBubble } from '@nocoo/basalt/components/chat-bubble';
import { Sparkles } from 'lucide-react';

export interface MessageListProps {
  turns: readonly ChatTurn[];
  agentName: string;
  onRetry(): void;
}

export default function MessageList({ turns, agentName, onRetry }: MessageListProps) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 px-2 text-center">
        <Sparkles
          className="h-8 w-8 text-basalt-foreground"
          strokeWidth={1.25}
          aria-hidden="true"
        />
        <div className="space-y-3">
          <h3
            className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[34px]"
            data-slot="chat-empty-hint"
          >
            What can we work on?
          </h3>
          <p className="text-sm leading-6 text-basalt-muted-foreground">
            A fresh conversation with {agentName}. Where shall we start?
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-10 sm:space-y-12">
      {turns.map((turn, index) => {
        const last = index === turns.length - 1;
        const canRetry = last && turn.status !== 'streaming' && turn.status !== 'completed';
        return (
          <article key={turn.id} aria-label={`Turn ${index + 1}`} className="min-w-0 space-y-7">
            <ChatBubble
              variant="user"
              className="chat-user-bubble max-w-[90%] px-4 py-3 text-[15px] leading-6 sm:max-w-[85%] sm:px-5"
            >
              <MessageText
                content={turn.userPrompt}
                className="font-basalt-sans text-[15px] leading-6"
              />
            </ChatBubble>
            <AgentResponse
              envelopes={turn.envelopes}
              agentName={agentName}
              status={turn.status}
              sessionId={turn.sessionId}
              error={turn.error}
              onRetry={canRetry ? onRetry : undefined}
              showPending={last}
            />
          </article>
        );
      })}
    </div>
  );
}
