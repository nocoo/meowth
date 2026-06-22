import { expect, test } from '@playwright/test';
import { handpasteToken, readRootToken } from './_fixtures';

// docs/architecture/07 §4 / 08 §4 — L3 (a) security-header surface.
//
// All assertions hit the live same-origin daemon (embed fixture on
// :17777) so we are testing the real chi middleware chain plus the
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

test('GET / serves index.html with full document header set', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
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

test('GET /healthz carries nosniff', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.status()).toBe(200);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
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
