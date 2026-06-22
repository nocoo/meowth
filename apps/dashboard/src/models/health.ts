// docs/architecture/06 §7.1 / §7.5 — health probe model.
//
// /healthz is unauthenticated; apiFetch still routes through the
// single transport so we keep one fetch path. When no token is
// stored, apiFetch simply omits the Authorization header.

import { apiFetch } from '@/lib/api';
import type { HealthzResponse } from './types';

export async function pingHealthz(): Promise<HealthzResponse> {
  return apiFetch<HealthzResponse>('/healthz');
}
