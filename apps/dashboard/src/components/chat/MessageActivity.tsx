import { displayLabel } from '@/lib/labels';
import type { Envelope } from '@/models/types';
import { Brain, ListChecks, Terminal } from 'lucide-react';
import ActivityDisclosure from './ActivityDisclosure';
import MessageBubble from './MessageBubble';
import { groupActivitySteps, messageField, messageKind } from './messageGroups';

export default function MessageActivity({
  envelopes,
  streaming,
  turnEnded,
  resultCallIds,
  fullOutput = false,
}: {
  envelopes: readonly Envelope[];
  streaming: boolean;
  turnEnded: boolean;
  resultCallIds: ReadonlySet<unknown>;
  fullOutput?: boolean;
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
          return (
            <MessageBubble
              key={envelope.seq}
              envelope={envelope}
              expanded
              fullOutput={fullOutput}
            />
          );
        }
        const rawTool = messageField(envelope, 'tool');
        const tool = typeof rawTool === 'string' && rawTool ? displayLabel(rawTool) : 'Tool call';
        const hasInput = messageField(envelope, 'input') != null;
        const reportedElsewhere = resultCallIds.has(messageField(envelope, 'call_id'));
        return (
          <ActivityDisclosure
            key={envelope.seq}
            label={tool}
            description={results.length > 0 ? 'Input & result' : 'Details'}
            icon={Terminal}
            kind="tool-call"
          >
            {hasInput ? (
              <MessageBubble envelope={envelope} expanded fullOutput={fullOutput} />
            ) : null}
            {results.map((result) => (
              <MessageBubble key={result.seq} envelope={result} expanded fullOutput={fullOutput} />
            ))}
            {results.length === 0 ? (
              <p className="text-xs leading-5 text-basalt-muted-foreground">
                {reportedElsewhere
                  ? 'Result recorded separately.'
                  : turnEnded
                    ? 'No tool result was reported by this agent.'
                    : 'Waiting for a tool result…'}
              </p>
            ) : null}
          </ActivityDisclosure>
        );
      })}
    </ActivityDisclosure>
  );
}
