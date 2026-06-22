// docs/architecture/06 §6.1 — model layer. Types here are
// derived from the generated OpenAPI schema in @meowth/shared
// where the wire shape is captured by the daemon's openapi.yaml.
// The /bootstrap/mint endpoint is intentionally not in the
// OpenAPI surface (docs/architecture/02 §3 + 04 §4.3), but its
// response is documented to be the same shape as
// `TokenCreateResponse`, so we narrow that here instead of
// hand-authoring a divergent copy.

import type { components } from '@meowth/shared';

export type Agent = components['schemas']['Agent'];
export type AgentListResponse = components['schemas']['AgentListResponse'];
export type TokenCreateResponse = components['schemas']['TokenCreateResponse'];

export interface MintRequest {
  setup_code: string;
}

// 04 §4.3: mint success body has the TokenCreateResponse shape,
// narrowed to created_via === 'first_run_mint'. secret carries
// the freshly issued bearer token (`mwt_*`).
export type MintResponse = TokenCreateResponse & {
  created_via: 'first_run_mint';
};
