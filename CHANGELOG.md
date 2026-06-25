# Changelog

All notable changes to **Meowth** — the macOS coding-agent bridge — are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-06-25

Dashboard Gen 2 structural UI redesign. Aligns the dashboard with
the basalt B05 four-layer brightness ladder and the surety Gen 2
floating-island app shell, and refactors every page into a
Page/Content/Skeleton split (plus an extracted dialog for Tokens).
No agent-SDK, daemon, or HTTP-API behavior changes.

Minor version bump because the dashboard component tree shifted
in a structurally breaking way (multiple components removed, file
layout reorganised); the public HTTP contract and daemon
behavior are unchanged.

### Added

- `components/layout/{app-shell,sidebar,sidebar-context,breadcrumbs}.tsx`
  — Gen 2 floating-island app shell ported from surety. AppShell
  owns the Sheet drawer trigger ref + manual `onCloseAutoFocus`
  for focus return; Sidebar is the floating-island L1
  navigation; SidebarContext shares collapsed/open state.
- `components/StatCard.tsx` — Overview metric tile
  (`{ title, body, icon? }`) used by the four "Daemon / Tokens /
  Sessions / Agents" tiles.
- Per-page Page / Content / Skeleton splits for Overview,
  Agents, SessionsList, SessionDetail, Tokens, and Settings.
  Page is a shell that owns the viewmodel + branch; Content is
  pure-props business render; Skeleton is the pre-data
  placeholder (stable string-key arrays, no index-as-key).
- `pages/Tokens/TokensCreateDialog.tsx` — extracted token-create
  dialog. Manual `role="dialog"` (non-destructive, so no G3
  alert-dialog). Plaintext lifecycle is bounded: the secret
  lives only in `vm.modal.createdSecret` during reveal phase
  and clears on close; SecretReveal stays masked by default and
  is asserted absent from the DOM after close.
- Stage A source-derived primitives from surety (19 files
  total: `tooltip` / `sheet` / `avatar` / `collapsible` /
  `separator` / `badge` / `skeleton` / `empty-state` G1 +
  `table` / `dropdown-menu` / `select` / `label` / `notice` /
  `section-divider` / `switch` / `textarea` / `toggle` /
  `toggle-group` / `sort-header` G2). Each carries a smoke
  test; the page/layout layer imports only what it currently
  needs.
- `dependency-cruiser` config and `pnpm dashboard:depcruise`
  in the G1 gate as the single source of truth for MVVM import
  boundaries (pages-must-not-import-models, models-must-not-
  import-react, pages-must-not-import-api).

### Changed

- Surface tier ladder formalised as L0 (`bg-background`) / L1
  (`bg-card` floating island) / L2 (`bg-secondary`) / L3
  (`bg-secondary` + `border-border` divider). One layer step
  per nesting level; Skeleton inherits the same ladder as its
  Content.
- `radix-ui` aggregate package replaces per-primitive
  `@radix-ui/react-<x>` packages. All source-copied ui files
  import from the `radix-ui` namespace.
- SettingsPage replaced the inline daemon healthz text with a
  semantic `<Notice>` mapped per state: success (reachable),
  warning (unreachable, polite), destructive (`role="alert"`,
  error). The Dashboard build row stays in the Page shell so
  its compile-time value is visible even during loading.
- SetupPage replaced the local `ErrorBanner` and the disabled-
  mint footnote `<p>` with semantic `<Notice>` (destructive
  for the error path, info for disabled-mint). All form
  behavior preserved — placeholders, validation regex, button
  copy, `noValidate`, `type="password"`, the dev-mint origin
  guard, and `resp.secret` handling are untouched.
- `docs/architecture/06-dashboard-mvvm-and-basalt.md` rewritten
  to reflect Gen 2 (§2 directory tree with the Page/Content/
  Skeleton sub-files; §4 surety provenance + the full A3/A4
  primitive inventory; §5.1 four-layer brightness ladder;
  §6.4 per-page split contract; §6.5 per-page test contract;
  §7 every page table expanded to list all sub-files; §12
  rewritten as implementation history covering Phase 3.13–3.20
  and Phase 2 Stage A/B/C/D).

### Removed

- `components/AppSidebar.tsx`, `components/DashboardLayout.tsx`,
  and `components/ui/card.tsx` (replaced by the Gen 2
  `components/layout/*` triplet + direct `bg-card` /
  `bg-secondary` Tailwind surfaces inside Content).

[0.3.0]: https://github.com/nocoo/meowth/releases/tag/v0.3.0

## [0.2.0] — 2026-06-25

Frontend toolchain bump to align with the basalt B-family baseline
(closest peer: surety). Daemon static-routing fix surfaced along
the way. No agent-SDK or HTTP-API changes.

Minor version bump because the dep tree shifted across several
major versions (Vite 6→8, React Router 7→8, TypeScript 5→6); the
public HTTP contract is unchanged.

### Changed

- **Frontend toolchain bumped**:
  - vite                  6.4.3   → 8.1.0
  - esbuild               0.25.0  → 0.28.1   (workspace override)
  - @vitejs/plugin-react  4.7.0   → 6.0.3
  - @tailwindcss/vite     ^4.2.2  → 4.3.1
  - tailwindcss           ^4.2.2  → 4.3.1
  - react-router          ~7.17.0 → 8.0.1
  - typescript            ^5.7.2  → ^6.0.3   (root + shared + dashboard)
  - @radix-ui/react-dialog 1.1.16 → 1.1.17
  - lucide-react          1.17.0  → 1.21.0
  - @playwright/test      1.61.0  → 1.61.1
  - @types/react          ^19.2.0 → ^19.2.17
  - @types/react-dom      ^19.2.0 → ^19.2.3
- `apps/dashboard/tsconfig.json` drops `baseUrl: "."` (deprecated in
  TS6, errors with TS5101) and uses an explicit `paths` mapping
  `"@/*": ["./src/*"]`. Same shape surety uses.
- `apps/dashboard/package.json` depcruise script now passes a glob
  `"src/**/*.{ts,tsx}"` — dependency-cruiser 16 dropped implicit
  directory recursion, a bare `src` argument silently scans 0 files.

### Fixed

- `daemon/internal/server`: `RootAsset` handler now serves the
  brand PNGs and favicon at the site root. v0.1.3 added the
  `<link rel="icon">` and `<link rel="apple-touch-icon">` in
  `apps/dashboard/index.html`, but the daemon only routed
  `/assets/*` — every brand asset 404'd in production-embed mode.
  Caught when the new Vite 8 build started actually requesting them
  during e2e.
  - Added 3 test cases covering happy path, missing-file, and the
    non-NotExist fs error branch (defense-in-depth).
  - server.go mounts a closed list of 5 hard-coded filenames
    (`favicon.ico`, `apple-touch-icon.png`, `logo-24.png`,
    `logo-80.png`, `og-image.png`); RootAsset takes the literal
    filename, so this is not a path-traversal exposure.

[0.2.0]: https://github.com/nocoo/meowth/releases/tag/v0.2.0

## [0.1.4] — 2026-06-25

README simplification + license clarification. Functional code
unchanged.

### Changed

- README cut down to: header + one-paragraph intro + 4-step quick
  start + docs links + license. The capability table, doc map,
  HTTP API recipes, remote-access section, dev commands list, and
  `~/.meowth/` layout all moved into existing `docs/` files so the
  README's job is "get me running in 4 commands".
- License section now clearly distinguishes the **repo-root MIT
  license** (covers all original code: daemon `cmd/` + `internal/`
  + dashboard + scripts + docs) from the **Modified Apache 2.0**
  retained for `daemon/pkg/agent/` (vendored from multica per
  Apache 2.0 §4). Adds a one-line disclaimer that multica's two
  extra clauses (anti-SaaS + retain-logo) do not apply to Meowth —
  it's a personal local tool and the dashboard is fully
  re-implemented (no `apps/web/` from multica).

The CHANGELOG entry for v0.1.0 previously summarised the license
as "Modified Apache 2.0 inherited from multica", which was
inaccurate; the root license has always been MIT.

[0.1.4]: https://github.com/nocoo/meowth/releases/tag/v0.1.4

## [0.1.3] — 2026-06-25

Branding pass + README normalization. Functional code unchanged.

### Added

- `logo.png` at repo root (2048×2048 RGBA) as the single source of
  truth for brand artwork.
- `scripts/resize-logos.py` (Python + Pillow) regenerates every
  derivative deterministically. Vite SPA variant — no Next.js
  `src/app/` convention — so outputs land in
  `apps/dashboard/public/`.
- `apps/dashboard/public/{logo-24,logo-80}.png`,
  `favicon.ico` (16+32 multi-size), `apple-touch-icon.png` (180),
  `og-image.png` (1200×630, dark `#171717` card).
- `apps/dashboard/index.html` now declares `<link rel="icon">`,
  `<link rel="apple-touch-icon">`, and the four `og:*` meta tags so
  social-preview crawlers (and the meowth.dev.hexly.ai Caddy host)
  render the OG card.
- Sidebar brand row now shows the 24×24 logo next to the "Meowth"
  wordmark (basalt B-3 convention).

### Changed

- README header rewritten to the personal-project standard: centered
  128×128 logo + h1 + tagline + shields.io badges
  (release / CI / platform / Go / Node / license) + horizontal rule.
  Body content unchanged.

[0.1.3]: https://github.com/nocoo/meowth/releases/tag/v0.1.3

## [0.1.2] — 2026-06-24

Patch release. v0.1.1 fixed only 2 of the 4 v0.1.0 CI failures; this
release finishes the job.

### Fixed

- **CI l3 job**: was failing with `scripts/build-daemon.sh: line 20:
  exec: go: not found`. The l3 fixture (`e2e-embed-fixture`) builds
  the daemon binary under test on the fly via `pnpm daemon:build`,
  which needs the Go toolchain — but the l3 job step list omitted
  `actions/setup-go@v5`. Added.
- **CI g2 (govulncheck)**: 1.26.2 (shipped in v0.1.1) itself had 3
  more stdlib CVEs after release: `GO-2026-5039` (net/textproto),
  `GO-2026-5037` (crypto/x509), `GO-2026-4971` (net). Bumped to
  `1.26.4`. Local govulncheck now clean against go1.26.4.

[0.1.2]: https://github.com/nocoo/meowth/releases/tag/v0.1.2

## [0.1.1] — 2026-06-24

Patch release that turns the v0.1.0 CI run green. The shipped daemon
binary is functionally identical; the changes are all CI / toolchain
hygiene.

### Fixed

- **CI lint + l1-dashboard**:`scripts/check-dashboard-source.sh`
  shells out to `ripgrep`,which the GitHub `macos-14` image does
  not ship. Both jobs now `brew install ripgrep` before running the
  source scan.
- **CI l3**: the `dashboard-dev` Playwright fixture spawns
  `meowthd init` via `tsx + go run`,which the GitHub runner kills
  with status `null` before the daemon ever serves. CI now scopes
  to `--project=dashboard-embed --project=dashboard-embed-mint`,
  matching the local convention recorded in
  `docs/features/01-port-migration-to-hexly-caddy.md` §6.2.
- **CI g2 (govulncheck)**: `daemon/go.mod` toolchain bumped from
  `1.26.1` to `1.26.2`,fixing 7 stdlib CVEs the v0.1.0 run flagged
  — notably `GO-2026-4870` (TLS 1.3 KeyUpdate persistent-connection
  DoS in `crypto/tls`) and `GO-2026-4866` (case-sensitive
  `excludedSubtrees` auth bypass in `crypto/x509`).

### Documentation

- `docs/architecture/README.md` corrected: CI workflow has existed
  since Phase 2.12 and was wrongly listed as "doc-only" in 0.1.0.
  Status section now enumerates the actual job list and the genuine
  still-manual items (D1 isolation, `dashboard-dev` L3).
- README's environment-requirements line bumped Go ≥ 1.26.2 to match
  the toolchain.

[0.1.1]: https://github.com/nocoo/meowth/releases/tag/v0.1.1
[0.1.0]: https://github.com/nocoo/meowth/releases/tag/v0.1.0

## [0.1.0] — 2026-06-24

First minor release. Phase 3.1–3.25 (daemon + dashboard + 6DQ test plan)
landed end-to-end. A `meowthd` binary now drives 5 real coding CLIs
(claude / codex / copilot / hermes / pi) over a single HTTP control plane
with bearer auth, persistent SQLite state, and an embedded dashboard.

### Added — Core capabilities

- **`meowthd` daemon binary** (`daemon/cmd/meowthd`):
  `init` / `bootstrap-token` / `serve` subcommands, default bind
  `127.0.0.1:7040`, `~/.meowth/` home layout (config.toml + SQLite +
  logs + runtime/).
- **5 backend Agent SDK** (`daemon/pkg/agent`, vendored from
  multica@4bbaf536): claude, codex, copilot, hermes, pi. End-to-end
  smoke against the real CLIs (`MEOWTH_CLI_SMOKE=1`) verifies each
  backend writes a real file in a real working directory.
- **HTTP control plane** (`daemon/internal/server`,
  [OpenAPI](daemon/internal/server/openapi.yaml)): 9 endpoints
  spanning `/healthz`, bearer tokens CRUD, agents probe + exec
  (NDJSON streaming), sessions list/get/messages/cancel, and the
  bootstrap mint endpoint.
- **Bearer token lifecycle**: `init` (path A, prints root token),
  `init --skip-token` + `/bootstrap/mint` (path B, setup-code via
  argon2id), `bootstrap-token` (emergency rotation), `POST /v1/tokens`
  (interactive create, one-shot secret), `DELETE /v1/tokens/{id}`
  (revoke).
- **4 remote access modes** (`daemon/internal/remoteaccess`):
  `local` / `tailscale` / `ssh_tunnel` / `https_proxy`, with
  startup validation, wildcard-bind rejection, and a three-section
  D0–D5 diagnostic on failure.
- **SQLite store** (`daemon/internal/store`, sqlc-generated): tokens
  with sha256+argon2id hashing, sessions, messages (append-only
  envelopes with monotonic `seq` for resumable streaming).
- **Dashboard SPA** (`apps/dashboard`, Vite 6 + React 19 + Tailwind v4
  + basalt design system, MVVM三段式): Setup (paste-token + mint),
  Overview, Agents, Sessions (with message tail), Tokens (one-shot
  secret reveal), Settings. Embedded into the daemon binary via
  `go:embed`.
- **Mint origin gate** (`docs/architecture/04` §6.6): `Origin == "http://" + r.Host`
  + `Sec-Fetch-Site` filtering + setup-nonce one-shot consumption +
  5-attempt lockout with timing jitter; protects against
  drive-by mint POSTs from other tabs.

### Added — Quality system (6DQ)

- **G1 static** (gofmt + vet + golangci-lint + biome + tsc + depcruise
  + dashboard source scanner).
- **G2 security** (osv-scanner + gitleaks + govulncheck).
- **L1 unit** with coverage gates: daemon target 95% (3 packages at
  target, 12 at baseline floor), dashboard target 90% (30 modules
  at target).
- **L2 real-HTTP harness** (`scripts/run-*-l2.ts`): tokens / mint /
  exec / remote-access.
- **L3 Playwright e2e** (`apps/dashboard/e2e`): embed (12 cases) +
  embed-mint (1 case) fixtures.
- **D1 isolation**: production `~/.meowth/` vs test `~/.meowth-test/`
  strictly separated via `MEOWTH_TEST=1`; `scripts/check-no-prod-test-mix.sh`
  guards against accidental cross-references.
- **Husky hooks**: pre-commit runs lint-staged; pre-push runs
  vet + typecheck + L1 + coverage gates + L2 + G2. L3 / D1 / CI matrix
  remain manual until the CI workflow lands.

### Added — Network & deployment

- **Hexly Caddy port allocation** ([`docs/features/01`](docs/features/01-port-migration-to-hexly-caddy.md)):
  - `meowth.dev.hexly.ai` → daemon `127.0.0.1:7040`
  - `meowth-vite.dev.hexly.ai` → Vite dev `127.0.0.1:37040`
  - e2e fixtures on `17040` (embed) and `17041` (embed-mint)
- **`daemon:build` reproducibility**: the Go binary's `Version`
  string is now stamped via `-ldflags "-X main.Version=..."` from
  the root `package.json`.

### Documentation

- 8 architecture docs (`docs/architecture/01..08`) covering SDK
  pump strategy, HTTP protocol, SQLite schema, bootstrap mint,
  remote access, dashboard MVVM, dashboard security/CSP/XSS, and
  6DQ wiring.
- Top-level `docs/01-project-overview.md` (the source of truth
  for goals, non-goals, architecture, phase plan).
- `docs/features/01-port-migration-to-hexly-caddy.md` records the
  Hexly Caddy migration with atomic-commit plan + verification log.
- README rewritten with capability table, docs map, quick start,
  and HTTP API recipes that match Phase 3.25 reality.

### Local fixes on top of vendored multica

Tracked in [`daemon/pkg/agent/UPSTREAM.md`](daemon/pkg/agent/UPSTREAM.md):

- **pi `message_end` / `turn_end` error mapping** — surface upstream
  provider errors as `Status="failed"` instead of silent
  `Status="completed"` with empty output.
- **pi session dir/file mode hardening** — `~/.multica/pi-sessions/`
  tightened to `0700` / `0600`.
- **hermes ACP approval optionId** — `handleAgentRequest` now picks
  an approve-shaped `optionId` from the request's own `options`
  array (preferring `allow_session` > `allow_always` > `allow_once`)
  so both hermes' generic permission flow and the edit-approval flow
  succeed. Without this fix every hermes tool call silently denied
  on hermes 0.17.0+.
- **codex semantic-inactivity test windows** widened for slow CI
  runners.

### Known gaps

- CI workflow (`.github/workflows/`) not yet implemented; release
  artifacts are built locally.
- Dashboard `dashboard-dev` Playwright project and Caddy HTTPS
  hand-test are not part of automation; verified manually per
  release.

