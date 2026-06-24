# Changelog

All notable changes to **Meowth** — the macOS coding-agent bridge — are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

