// docs/architecture/06 §7.2 + §9.2 — Agents model.
//
// 3.19 introduced fetchAgents() for the Setup mode-A probe. 3.20a
// extends with execAgent() so the upcoming Session detail UI and
// L3 happy path can stream agent output. The endpoint returns
// `application/x-ndjson` per 02 §5 / openapi.yaml; callers parse
// the stream through models/envelope.decodeChunk.

import { apiFetch, apiStream } from '@/lib/api';
import type { Agent, AgentListResponse, ExecRequest } from './types';

export type AgentType = Agent['type'];

export async function fetchAgents(): Promise<AgentListResponse> {
  return apiFetch<AgentListResponse>('/v1/agents');
}

export interface ExecAgentOptions {
  signal?: AbortSignal;
}

export async function execAgent(
  type: AgentType,
  req: ExecRequest,
  opts: ExecAgentOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify(req),
  };
  if (opts.signal !== undefined) {
    init.signal = opts.signal;
  }
  return apiStream(`/v1/agents/${encodeURIComponent(type)}/exec`, init);
}
