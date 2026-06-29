import { describe, expect, it } from 'vitest';
import {
  CHAT_SEMANTIC_INACTIVITY_TIMEOUT_MS,
  CHAT_TIMEOUT_MS,
  buildExecRequest,
  deriveTurnStatusFromEnvelopes,
  extractResumeSessionId,
  extractSessionId,
} from './chat';
import type { Envelope } from './types';

// Pure model L1 tests for docs/features/03 commit #2.
// Every assertion locks one of the red lines documented in
// §3.2 (ExecRequest field set), §3.3 (resume id only from
// session_ended), §3.5 (terminal status taxonomy), or §5.4
// (ChatTurn shape). Keeping these in one file makes the
// review surface for task #15 a single grep.

function makeEnvelope(over: Partial<Envelope> & Pick<Envelope, 'type'>): Envelope {
  return {
    v: 1,
    seq: 0,
    ts: '2026-06-30T07:00:00Z',
    session_id: 'sid-default',
    payload: {},
    ...over,
  };
}

describe('buildExecRequest', () => {
  const FIRST_TURN_KEYS = ['prompt', 'timeout_ms', 'semantic_inactivity_timeout_ms'];
  const FOLLOW_UP_KEYS = [...FIRST_TURN_KEYS, 'resume_session_id'];
  // §3.2 禁止字段（client 侧硬性不发）— locked by an assertion below.
  const FORBIDDEN_KEYS = [
    'cwd',
    'custom_args',
    'mcp_config',
    'system_prompt',
    'thread_name',
    'max_turns',
    'thinking_level',
  ] as const;

  it('first turn omits resume_session_id entirely (key is absent, not null / empty string)', () => {
    const req = buildExecRequest({ prompt: 'hi', resumeSessionId: null });
    expect(Object.keys(req).sort()).toEqual([...FIRST_TURN_KEYS].sort());
    expect(Object.hasOwn(req, 'resume_session_id')).toBe(false);
  });

  it('first turn locks the timeout values to the §3.2 policy constants', () => {
    const req = buildExecRequest({ prompt: 'hi', resumeSessionId: null });
    expect(req.timeout_ms).toBe(600_000);
    expect(req.semantic_inactivity_timeout_ms).toBe(60_000);
    // Sanity-check the exported constants match the wire values.
    expect(CHAT_TIMEOUT_MS).toBe(600_000);
    expect(CHAT_SEMANTIC_INACTIVITY_TIMEOUT_MS).toBe(60_000);
  });

  it('follow-up turn includes resume_session_id alongside the four base fields', () => {
    const req = buildExecRequest({ prompt: 'next', resumeSessionId: 'bsid-1' });
    expect(Object.keys(req).sort()).toEqual([...FOLLOW_UP_KEYS].sort());
    expect(req.resume_session_id).toBe('bsid-1');
    // base fields stay verbatim
    expect(req.prompt).toBe('next');
    expect(req.timeout_ms).toBe(600_000);
    expect(req.semantic_inactivity_timeout_ms).toBe(60_000);
  });

  it('passes the user prompt through verbatim (whitespace, newlines, unicode)', () => {
    const tricky = '   line one\n\nline two\t— ✓\n';
    const req = buildExecRequest({ prompt: tricky, resumeSessionId: null });
    expect(req.prompt).toBe(tricky);
  });

  it('forbidden ExecRequest fields are never emitted (cwd / custom_args / mcp_config / system_prompt / thread_name / max_turns / thinking_level)', () => {
    const first = buildExecRequest({ prompt: 'a', resumeSessionId: null });
    const followup = buildExecRequest({ prompt: 'b', resumeSessionId: 'bsid-1' });
    for (const key of FORBIDDEN_KEYS) {
      expect(Object.hasOwn(first, key), `first turn must not emit ${key}`).toBe(false);
      expect(Object.hasOwn(followup, key), `follow-up turn must not emit ${key}`).toBe(false);
    }
  });
});

describe('extractSessionId', () => {
  it('returns null on an empty envelope list', () => {
    expect(extractSessionId([])).toBeNull();
  });

  it('returns the session_id of the first session_started envelope', () => {
    const envs: Envelope[] = [
      makeEnvelope({ type: 'session_started', session_id: 'sid-1' }),
      makeEnvelope({ type: 'message', seq: 1 }),
    ];
    expect(extractSessionId(envs)).toBe('sid-1');
  });

  it('returns null when no session_started envelope has arrived yet (abort-before-start window)', () => {
    const envs: Envelope[] = [
      makeEnvelope({ type: 'heartbeat' }),
      makeEnvelope({ type: 'message' }),
    ];
    expect(extractSessionId(envs)).toBeNull();
  });

  it('treats an empty-string session_id as null', () => {
    const envs: Envelope[] = [makeEnvelope({ type: 'session_started', session_id: '' })];
    expect(extractSessionId(envs)).toBeNull();
  });
});

describe('extractResumeSessionId (§3.3 red line)', () => {
  it('returns null on an empty envelope list', () => {
    expect(extractResumeSessionId([])).toBeNull();
  });

  it('ignores message kind=status backend_session_id (provisional / cache only, §3.3)', () => {
    const envs: Envelope[] = [
      makeEnvelope({
        type: 'message',
        seq: 1,
        payload: { kind: 'status', backend_session_id: 'status-id' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBeNull();
  });

  it('ignores session_started payload.backend_session_id (may be empty on first turn, §3.3)', () => {
    const envs: Envelope[] = [
      makeEnvelope({
        type: 'session_started',
        session_id: 'sid-1',
        payload: { backend_session_id: 'start-id' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBeNull();
  });

  it('returns the backend_session_id from a session_ended envelope', () => {
    const envs: Envelope[] = [
      makeEnvelope({ type: 'session_started', session_id: 'sid-1' }),
      makeEnvelope({
        type: 'session_ended',
        seq: 2,
        payload: { status: 'completed', backend_session_id: 'end-id' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBe('end-id');
  });

  it('returns null when session_ended.payload.backend_session_id is the empty string', () => {
    const envs: Envelope[] = [
      makeEnvelope({
        type: 'session_ended',
        payload: { status: 'completed', backend_session_id: '' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBeNull();
  });

  it('prefers session_ended over a preceding status envelope (cache must not win)', () => {
    const envs: Envelope[] = [
      makeEnvelope({ type: 'session_started', session_id: 'sid-1' }),
      makeEnvelope({
        type: 'message',
        seq: 1,
        payload: { kind: 'status', backend_session_id: 'status-id' },
      }),
      makeEnvelope({
        type: 'session_ended',
        seq: 2,
        payload: { status: 'completed', backend_session_id: 'end-id' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBe('end-id');
  });

  it('uses the last session_ended envelope if (defensively) more than one is present', () => {
    const envs: Envelope[] = [
      makeEnvelope({
        type: 'session_ended',
        seq: 1,
        payload: { status: 'completed', backend_session_id: 'first' },
      }),
      makeEnvelope({
        type: 'session_ended',
        seq: 2,
        payload: { status: 'completed', backend_session_id: 'second' },
      }),
    ];
    expect(extractResumeSessionId(envs)).toBe('second');
  });
});

describe('deriveTurnStatusFromEnvelopes (§3.5 envelope-delivered branch)', () => {
  function endedWith(status: string, backendSessionId = 'bsid'): Envelope {
    return makeEnvelope({
      type: 'session_ended',
      seq: 9,
      payload: { status, backend_session_id: backendSessionId },
    });
  }

  it('returns null when no session_ended envelope has arrived', () => {
    expect(deriveTurnStatusFromEnvelopes([])).toBeNull();
    expect(
      deriveTurnStatusFromEnvelopes([
        makeEnvelope({ type: 'session_started', session_id: 'sid-1' }),
        makeEnvelope({ type: 'message', seq: 1 }),
      ]),
    ).toBeNull();
  });

  it.each([
    'completed' as const,
    'failed' as const,
    'timeout' as const,
    'cancelled' as const,
    'aborted' as const,
  ])('passes daemon terminal status %s through verbatim', (status) => {
    const result = deriveTurnStatusFromEnvelopes([endedWith(status, 'bsid-x')]);
    expect(result).toEqual({ status, backendSessionId: 'bsid-x' });
  });

  it('returns null when daemon emits an unknown status string (no guessing)', () => {
    const result = deriveTurnStatusFromEnvelopes([endedWith('foo')]);
    expect(result).toBeNull();
  });

  it('returns null backendSessionId when payload.backend_session_id is missing or empty', () => {
    const envs: Envelope[] = [
      makeEnvelope({
        type: 'session_ended',
        payload: { status: 'completed' /* no backend_session_id */ },
      }),
    ];
    expect(deriveTurnStatusFromEnvelopes(envs)).toEqual({
      status: 'completed',
      backendSessionId: null,
    });
  });
});
