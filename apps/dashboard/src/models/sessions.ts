// docs/architecture/06 §7.3 — Sessions model (snapshot mode only).
//
// follow=true is intentionally NOT modelled here. The daemon
// today rejects follow=true with HTTP 400 ('invalid_request');
// 06 §7.3 promises a tail-follow stream eventually, but the
// dashboard talks to whatever the daemon implements. When the
// daemon ships streaming follow support, this file gains a
// followSessionMessages(...) helper.

import { apiFetch } from '@/lib/api';
import type { EnvelopeType, MessagesSnapshotResponse, Session, SessionListResponse } from './types';

export type SessionStatusFilter = Session['status'];

export interface ListSessionsOptions {
  status?: SessionStatusFilter | readonly SessionStatusFilter[];
  before?: string;
  limit?: number;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    usp.set(key, String(value));
  }
  const out = usp.toString();
  return out.length === 0 ? '' : `?${out}`;
}

export async function listSessions(opts: ListSessionsOptions = {}): Promise<SessionListResponse> {
  const status: string | undefined =
    opts.status === undefined
      ? undefined
      : Array.isArray(opts.status)
        ? opts.status.join(',')
        : (opts.status as string);
  const query = buildQuery({
    status,
    before: opts.before,
    limit: opts.limit,
  });
  return apiFetch<SessionListResponse>(`/v1/sessions${query}`);
}

export async function getSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/v1/sessions/${encodeURIComponent(id)}`);
}

export interface GetSessionMessagesOptions {
  after_seq?: number;
  limit?: number;
  // CSV filter; we restrict to known envelope types to avoid
  // accidentally sending arbitrary strings.
  types?: readonly EnvelopeType[];
}

export async function getSessionMessages(
  id: string,
  opts: GetSessionMessagesOptions = {},
): Promise<MessagesSnapshotResponse> {
  const query = buildQuery({
    after_seq: opts.after_seq,
    limit: opts.limit,
    types: opts.types && opts.types.length > 0 ? opts.types.join(',') : undefined,
  });
  return apiFetch<MessagesSnapshotResponse>(
    `/v1/sessions/${encodeURIComponent(id)}/messages${query}`,
  );
}
