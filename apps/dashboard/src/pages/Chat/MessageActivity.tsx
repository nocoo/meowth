import type { Envelope } from '@/viewmodels/useChatViewModel';
import { Brain, ListChecks, Terminal } from 'lucide-react';
import ActivityDisclosure from './ActivityDisclosure';
import MessageBubble from './MessageBubble';
import { groupActivitySteps, messageField, messageKind } from './messageGroups';

export default function MessageActivity({
  envelopes,
  streaming,
}: {
  envelopes: readonly Envelope[];
  streaming: boolean;
}) {
  const steps = groupActivitySteps(envelopes);
  const tools = steps.filter((step) =>
    ['tool-use', 'tool-result'].includes(messageKind(step.envelope)),
  );
  const thinking = envelopes.some((envelope) => messageKind(envelope) === 'thinking');
  const label =
    tools.length > 0
      ? `${streaming ? 'Working with' : 'Used'} ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
      : thinking
        ? streaming
          ? 'Thinking'
          : 'Thought process'
        : 'Agent activity';

  return (
    <ActivityDisclosure
      label={label}
      icon={thinking ? Brain : ListChecks}
      kind="activity"
      busy={streaming}
    >
      {steps.map(({ envelope, results }) => {
        const kind = messageKind(envelope);
        if (kind !== 'tool-use') {
          return <MessageBubble key={envelope.seq} envelope={envelope} expanded />;
        }
        const rawTool = messageField(envelope, 'tool');
        const tool = typeof rawTool === 'string' && rawTool ? rawTool : 'Tool call';
        return (
          <ActivityDisclosure
            key={envelope.seq}
            label={tool}
            description={results.length > 0 ? 'Input & result' : 'Input'}
            icon={Terminal}
            kind="tool-call"
          >
            <MessageBubble envelope={envelope} expanded />
            {results.map((result) => (
              <MessageBubble key={result.seq} envelope={result} expanded />
            ))}
          </ActivityDisclosure>
        );
      })}
    </ActivityDisclosure>
  );
}
