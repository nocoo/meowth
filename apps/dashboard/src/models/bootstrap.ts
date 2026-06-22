// docs/architecture/06 §7.6 / 04 §4.3 — bootstrap (mint) model.
//
// Unauthenticated POST. apiFetch will skip the Authorization
// header when no token is stored, which is the normal case for
// the mint path (the user is bootstrapping their first token).

import { apiFetch } from '@/lib/api';
import type { MintRequest, MintResponse } from './types';

export async function mintWithSetupCode(setupCode: string): Promise<MintResponse> {
  return apiFetch<MintResponse>('/bootstrap/mint', {
    method: 'POST',
    body: JSON.stringify({ setup_code: setupCode } satisfies MintRequest),
  });
}
