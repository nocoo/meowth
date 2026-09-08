import type { Envelope } from '@/models/types';

export function messageField(env: Envelope, key: string): unknown {
  return env.payload[key];
}

export function messageKind(env: Envelope): string {
  const raw = messageField(env, 'kind');
  return env.type === 'message' && typeof raw === 'string' ? raw : '';
}

const VISIBLE_MESSAGE_KINDS = new Set([
  'text',
  'thinking',
  'tool-use',
  'tool-result',
  'error',
  'log',
]);

const ACTIVITY_KINDS = new Set(['thinking', 'tool-use', 'tool-result', 'log']);

function isInvisibleEnvelope(env: Envelope): boolean {
  if (env.type === 'session_started' || env.type === 'heartbeat') return true;
  return env.type === 'message' && !VISIBLE_MESSAGE_KINDS.has(messageKind(env));
}

// Keep the first delta's identity so disclosures stay open as the stream grows.
export function groupEnvelopes(envelopes: readonly Envelope[]): Envelope[] {
  const out: Envelope[] = [];
  for (const env of envelopes) {
    if (isInvisibleEnvelope(env)) continue;
    const kind = messageKind(env);
    const previous = out.at(-1);
    if (previous && (kind === 'text' || kind === 'thinking') && messageKind(previous) === kind) {
      const previousContent = messageField(previous, 'content');
      const nextContent = messageField(env, 'content');
      const before = typeof previousContent === 'string' ? previousContent : '';
      const next = typeof nextContent === 'string' ? nextContent : '';
      out[out.length - 1] = {
        ...previous,
        payload: { ...previous.payload, content: before + next },
      };
    } else {
      out.push(env);
    }
  }
  return out;
}

export type MessageGroup =
  | { kind: 'message'; seq: number; envelope: Envelope }
  | { kind: 'activity'; seq: number; envelopes: Envelope[] };

export function groupMessageActivity(envelopes: readonly Envelope[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const envelope of envelopes) {
    if (!ACTIVITY_KINDS.has(messageKind(envelope))) {
      groups.push({ kind: 'message', seq: envelope.seq, envelope });
      continue;
    }
    const last = groups.at(-1);
    if (last?.kind === 'activity') {
      last.envelopes.push(envelope);
    } else {
      groups.push({ kind: 'activity', seq: envelope.seq, envelopes: [envelope] });
    }
  }
  return groups;
}

export interface ActivityStep {
  envelope: Envelope;
  results: Envelope[];
}

export function groupActivitySteps(envelopes: readonly Envelope[]): ActivityStep[] {
  const steps: ActivityStep[] = [];
  const calls = new Map<string, ActivityStep>();
  for (const envelope of envelopes) {
    const kind = messageKind(envelope);
    const callId = messageField(envelope, 'call_id');
    const call = typeof callId === 'string' && callId ? calls.get(callId) : undefined;
    if (kind === 'tool-result' && call) {
      call.results.push(envelope);
      continue;
    }
    const step: ActivityStep = { envelope, results: [] };
    steps.push(step);
    if (kind === 'tool-use' && typeof callId === 'string' && callId) calls.set(callId, step);
  }
  return steps;
}
