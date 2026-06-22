// docs/architecture/06 §7.4 — Tokens model.
//
// Wraps the three /v1/tokens endpoints. revokeToken returns the
// generated TokenDeleteResponse JSON (HTTP 200), not 204.

import { apiFetch } from '@/lib/api';
import type {
  TokenCreateRequest,
  TokenCreateResponse,
  TokenDeleteResponse,
  TokenListResponse,
} from './types';

export async function listTokens(): Promise<TokenListResponse> {
  return apiFetch<TokenListResponse>('/v1/tokens');
}

export async function createToken(req: TokenCreateRequest): Promise<TokenCreateResponse> {
  return apiFetch<TokenCreateResponse>('/v1/tokens', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function revokeToken(id: string): Promise<TokenDeleteResponse> {
  return apiFetch<TokenDeleteResponse>(`/v1/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
