import type { Envelope } from '@/models/types';

// docs/features/03 §5.1 — "多个 text 块合并为一条流".
//
// Chat backends differ wildly in text granularity: claude emits one
// `message.kind=text` per content block, while pi / copilot emit one
// per streamed token delta. Rendering each envelope as its own bubble
// (the pre-fix behaviour) made pi/copilot output look shredded — every
// few characters wrapped into a new bubble.
//
// This pure helper regroups a turn's envelopes for RENDERING only. The
// raw `turn.envelopes` array is never mutated; resume-id / status /
// Sessions-detail data keep reading the unmodified stream. Grouping
// rule:
//   - consecutive `message.kind=text` envelopes coalesce into ONE
//     synthetic text envelope whose content is the concatenation;
//   - a visible non-text envelope (tool-use / tool-result / thinking /
//     error / log / usage / session_ended / type=error) is a boundary:
//     it flushes the current text run and passes through unchanged;
//   - an invisible envelope (session_started / heartbeat /
//     message.kind=status, plus any unknown message kind that
//     MessageBubble renders as null) is skipped entirely — it neither
//     emits a bubble nor breaks a text run, so `text, heartbeat, text`
//     still merges into a single block.
//
// The synthetic merged envelope keeps the FIRST text envelope's
// metadata (seq / session_id / ts), so MessageBubble's existing
// truncation + `/sessions/<id>` deep-link behaviour applies to the
// merged content exactly as it did per-envelope.

function readField(env: Envelope, key: string): unknown {
  const payload = env.payload as Record<string, unknown> | null | undefined;
  return payload?.[key];
}

function messageKind(env: Envelope): string {
  const raw = readField(env, 'kind');
  return typeof raw === 'string' ? raw : '';
}

function textContent(env: Envelope): string {
  const raw = readField(env, 'content');
  return typeof raw === 'string' ? raw : '';
}

function isTextEnvelope(env: Envelope): boolean {
  return env.type === 'message' && messageKind(env) === 'text';
}

// Message kinds MessageBubble renders as visible content. Anything
// outside this set (status, or a future unknown kind) renders as null,
// so it is treated as invisible here to avoid empty bubbles.
const VISIBLE_MESSAGE_KINDS = new Set([
  'text',
  'thinking',
  'tool-use',
  'tool-result',
  'error',
  'log',
]);

function isInvisibleEnvelope(env: Envelope): boolean {
  if (env.type === 'session_started' || env.type === 'heartbeat') return true;
  if (env.type === 'message') return !VISIBLE_MESSAGE_KINDS.has(messageKind(env));
  return false;
}

function mergeTextRun(run: readonly Envelope[]): Envelope {
  const first = run[0] as Envelope;
  if (run.length === 1) return first;
  const merged = run.map(textContent).join('');
  return {
    ...first,
    payload: { ...(first.payload ?? {}), kind: 'text', content: merged },
  };
}

/**
 * Regroup a turn's envelopes for rendering. Returns a new array; the
 * input is never mutated. Consecutive text envelopes are merged into a
 * single synthetic text envelope; invisible envelopes are dropped;
 * everything else passes through in order.
 */
export function groupEnvelopes(envelopes: readonly Envelope[]): Envelope[] {
  const out: Envelope[] = [];
  let textRun: Envelope[] = [];

  const flush = (): void => {
    if (textRun.length === 0) return;
    out.push(mergeTextRun(textRun));
    textRun = [];
  };

  for (const env of envelopes) {
    if (isTextEnvelope(env)) {
      textRun.push(env);
    } else if (!isInvisibleEnvelope(env)) {
      // Visible non-text envelope is a boundary: flush the current
      // text run, then emit it. Invisible envelopes (the implicit
      // else) are skipped entirely so they neither emit a bubble
      // nor break a surrounding text run.
      flush();
      out.push(env);
    }
  }
  flush();
  return out;
}
