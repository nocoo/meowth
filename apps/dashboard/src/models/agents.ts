// docs/architecture/06 §7.2 + §9.2 — Agents model.
//
// 3.19 introduces the minimum shape needed for the Setup mode-A
// probe: after the user pastes a bearer, we call this endpoint
// to confirm the daemon accepts it (06 §9.2). The Agents page
// itself is wired in 3.20.

import { apiFetch } from '@/lib/api';
import type { AgentListResponse } from './types';

export async function fetchAgents(): Promise<AgentListResponse> {
  return apiFetch<AgentListResponse>('/v1/agents');
}
