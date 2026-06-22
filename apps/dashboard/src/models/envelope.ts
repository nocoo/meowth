// docs/architecture/02 §5 — NDJSON envelope decoder.
//
// The agent exec endpoint (and future /messages?follow=true)
// streams one Envelope per line. This module is a pure decoder:
// no fetch, no React, no I/O. It accepts byte chunks or strings,
// buffers any partial trailing line, and emits validated Envelope
// objects. Invalid lines return null and are dropped silently;
// callers must NOT coerce partial JSON into an Envelope shape.
//
// The validator checks v === 1, seq is a finite number, ts /
// session_id are strings, type is in the union the daemon
// currently advertises in openapi.yaml, and payload is a plain
// object. Anything else returns null.

import type { Envelope, EnvelopeType } from './types';

const KNOWN_TYPES: ReadonlySet<EnvelopeType> = new Set<EnvelopeType>([
  'session_started',
  'message',
  'usage',
  'error',
  'session_ended',
  'heartbeat',
]);

function isKnownType(value: unknown): value is EnvelopeType {
  return typeof value === 'string' && KNOWN_TYPES.has(value as EnvelopeType);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeLine(line: string): Envelope | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;
  const r = raw as {
    v?: unknown;
    seq?: unknown;
    ts?: unknown;
    session_id?: unknown;
    type?: unknown;
    payload?: unknown;
  };
  if (r.v !== 1) return null;
  if (typeof r.seq !== 'number' || !Number.isFinite(r.seq)) return null;
  if (typeof r.ts !== 'string' || r.ts.length === 0) return null;
  if (typeof r.session_id !== 'string' || r.session_id.length === 0) return null;
  if (!isKnownType(r.type)) return null;
  if (!isPlainObject(r.payload)) return null;
  return raw as Envelope;
}

export interface DecodeChunkResult {
  envelopes: Envelope[];
  remaining: string;
}

export function decodeChunk(buffer: string, chunk: string): DecodeChunkResult {
  const combined = buffer + chunk;
  const lines = combined.split('\n');
  const remaining = lines.pop() ?? '';
  const envelopes: Envelope[] = [];
  for (const line of lines) {
    const env = decodeLine(line);
    if (env !== null) envelopes.push(env);
  }
  return { envelopes, remaining };
}
