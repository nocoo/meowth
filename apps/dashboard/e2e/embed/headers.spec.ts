import { expect, test } from '@playwright/test';
import { handpasteToken, readRootToken } from './_fixtures';

// docs/architecture/07 §4 / 08 §4 — L3 (a) security-header surface.
//
// All assertions hit the live same-origin daemon (embed fixture on
// :17040) so we are testing the real chi middleware chain plus the
// static.Index / static.Asset wrappers, not a mock. The HTML
// document, the hashed asset, the JSON API error, and /healthz each
// have a distinct header contract:
//
//   - GET /          → secheaders.Document(): full doc set + nosniff
//                       + Cache-Control: no-cache + Content-Type: text/html
//   - GET /assets/*  → secheaders.Asset(immutable=true): nosniff +
//                       CORP same-origin + Cache-Control immutable;
//                       NO CSP / Referrer-Policy / COOP / Permissions-Policy
//   - GET /v1/agents (401) → nosniff (global) but NO doc headers
//                       (07 §4.1 forbids them on API responses)
//   - GET /healthz   → nosniff (global)

const DOC_HEADER_NAMES = [
  'content-security-policy',
  'referrer-policy',
  'cross-origin-opener-policy',
  'permissions-policy',
] as const;

// docs/architecture/07 §4.2 — every CSP directive token is part of
// the reviewed contract. Spec asserts the full set, not a subset,
// so a future regression that drops or weakens a directive fails
// loudly instead of slipping past partial matches.
const CSP_DIRECTIVE_TOKENS = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
] as const;

test('GET / serves index.html with full document header set', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  const csp = h['content-security-policy'] ?? '';
  for (const directive of CSP_DIRECTIVE_TOKENS) {
    expect(csp, `CSP missing directive: ${directive}`).toContain(directive);
  }
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['cross-origin-resource-policy']).toBe('same-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  expect(h['cache-control']).toBe('no-cache');
  expect(h['content-type']).toMatch(/^text\/html/);
});

test('GET /assets/<hashed>.js serves the asset header set without document headers', async ({
  request,
}) => {
  // Discover a hashed asset path from the index HTML so the test
  // does not hard-code Vite's output filenames.
  const indexRes = await request.get('/');
  expect(indexRes.status()).toBe(200);
  const html = await indexRes.text();
  // Vite emits absolute /assets/... paths by default.
  const match = html.match(/\/assets\/[A-Za-z0-9_.-]+\.js/);
  if (match === null) {
    throw new Error('could not find a hashed /assets/*.js reference in index.html');
  }
  const assetPath = match[0];

  const res = await request.get(assetPath);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['cross-origin-resource-policy']).toBe('same-origin');
  expect(h['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(h['content-type']).toMatch(/javascript/);
  // 07 §4.1 — these headers MUST NOT appear on asset responses.
  for (const name of DOC_HEADER_NAMES) {
    expect(h[name]).toBeUndefined();
  }
});

test('GET /v1/agents with no bearer carries nosniff but no document headers', async ({
  request,
}) => {
  const res = await request.get('/v1/agents');
  expect(res.status()).toBe(401);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  // CORP is a document-pane header per 07 §4.1; API responses must
  // not advertise it. (Asset endpoints do; that is asserted above.)
  expect(h['cross-origin-resource-policy']).toBeUndefined();
  for (const name of DOC_HEADER_NAMES) {
    expect(h[name]).toBeUndefined();
  }
  // Defense-in-depth: the 401 body must not echo back any plaintext
  // token state. We have a known root token from the fixture; assert
  // the body does not contain it (it shouldn't — we never sent it —
  // but the check pins the contract).
  const body = await res.text();
  expect(body).not.toContain(readRootToken());
});

test('GET /healthz carries nosniff but no document headers', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  // 07 §4.1 — /healthz is not a document and not an asset, so
  // document-level headers must be absent. CORP is intentionally
  // not required here per reviewer correction.
  for (const name of DOC_HEADER_NAMES) {
    expect(h[name]).toBeUndefined();
  }
});

test('handpasted root token still works after header probes (no session pollution)', async ({
  page,
}) => {
  // Smoke: the previous tests use a separate APIRequestContext so
  // they don't share state with the page, but pin that the embed
  // fixture is still healthy enough to drive a normal login flow.
  await handpasteToken(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
});
