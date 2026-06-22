// docs/architecture/06 §8.1 / §8.2 — daemon HTTP client.
//
// Pure transport: every dashboard fetch goes through apiFetch /
// apiStream. The wrapper attaches the stored bearer (if any),
// surfaces RFC 7807 problem+json failures as a structured
// ApiError, and clears the stored token on HTTP 401 so a stale
// bearer doesn't loop forever. It does NOT log; the caller (or
// 3.16 logger.ts) owns log/toast/redaction.
//
// Network rejections (fetch reject, DNS failure, abort, etc.)
// propagate as-is and never clear the token — 06 §10 needs the
// AuthGate to map those to <DaemonUnreachable/>, not /setup.

import { clearStoredToken, getStoredToken } from './localStorage';

export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export interface ApiError {
  status: number;
  problem: ApiProblem;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { status?: unknown; problem?: unknown };
  if (typeof v.status !== 'number') return false;
  const p = v.problem;
  if (typeof p !== 'object' || p === null) return false;
  const pr = p as { type?: unknown; title?: unknown; status?: unknown };
  return (
    typeof pr.type === 'string' && typeof pr.title === 'string' && typeof pr.status === 'number'
  );
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function methodMayHaveBody(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (
    init?.body !== undefined &&
    init.body !== null &&
    methodMayHaveBody(init.method) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', JSON_CONTENT_TYPE);
  }
  return headers;
}

function asProblem(raw: unknown, fallbackStatus: number, fallbackTitle: string): ApiProblem {
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as { type?: unknown; title?: unknown; status?: unknown };
    if (typeof r.type === 'string' && typeof r.title === 'string' && typeof r.status === 'number') {
      return raw as ApiProblem;
    }
  }
  return {
    type: '/problems/unknown',
    title: fallbackTitle,
    status: fallbackStatus,
  };
}

async function readProblem(resp: Response): Promise<ApiProblem> {
  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    raw = undefined;
  }
  return asProblem(raw, resp.status, resp.statusText || `HTTP ${resp.status}`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildHeaders(init);
  const resp = await fetch(path, { ...init, headers });
  if (!resp.ok) {
    const problem = await readProblem(resp);
    if (resp.status === 401) clearStoredToken();
    throw { status: resp.status, problem } satisfies ApiError;
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export async function apiStream(
  path: string,
  init: RequestInit = {},
): Promise<ReadableStream<Uint8Array>> {
  const headers = buildHeaders(init);
  const resp = await fetch(path, { ...init, headers });
  if (!resp.ok) {
    const problem = await readProblem(resp);
    if (resp.status === 401) clearStoredToken();
    throw { status: resp.status, problem } satisfies ApiError;
  }
  if (!resp.body) {
    throw {
      status: 500,
      problem: {
        type: '/problems/no_body',
        title: 'No stream body',
        status: 500,
      },
    } satisfies ApiError;
  }
  return resp.body;
}
