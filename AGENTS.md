# Meowth

Local Go daemon and web dashboard for running and observing installed AI agents.
Profile: native-tool (Go daemon/CLI) + ts-web.
Direction: [project overview](docs/01-project-overview.md). Frameworks must preserve this handbook.

## Sources of Truth

This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.

| Fact | Where |
|---|---|
| Product / design | [README.md](README.md), [docs index](docs/README.md) |
| Local service / workflow | [agent workflow](docs/02-agent-workflow.md) |
| Commands / toolchain | root `package.json`, `daemon/go.mod`, workspace manifests |
| Quality / isolation | `scripts/check-*-coverage.sh`, `daemon/internal/home`, `daemon/internal/store`, CI |
| Accidents | [Retrospective.md](Retrospective.md) |
| Machine workflow | global `AGENTS.md` and Git rules |

## Project Invariants

- Canonical dev entry is `https://meowth.dev.hexly.ai`; reuse daemon 7040 and Vite 37040 after checking listeners. The live Caddyfile defines proxy routing and wildcard TLS.
- Normal services use existing user config/tokens/sessions; do not rerun `init` or inject `MEOWTH_TEST`, `MEOWTH_TEST_HOME` or fake backends into them.
- Agent processes run with the current user permissions and can call paid models or perform external actions. Tokens grant full daemon access; never expose them in logs, traces or fixtures.
- Keep Go outside the pnpm workspace and preserve dashboard Model/ViewModel boundaries. Rebuild/embed the dashboard when producing a daemon binary.
- Use numbered design docs, independent directory indexes and atomic commits; long-task plans include code references and 6DQ without effort estimates. Preserve existing coverage floors; add no new exceptions.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Daemon | `daemon/cmd/meowthd`, Go + SQLite |
| Dashboard | `apps/dashboard`, Vite/React/Basalt |
| Shared / build | `packages/shared`, pnpm/Turborepo/Biome |

## Commands

Run from root with pnpm 11.6.0, the Go toolchain in `daemon/go.mod` (1.26.6), Node matching CI 22.23.2, Bash 4+ and installed scanners. Ordinary L2 uses fake backends; real-agent lanes are opt-in and require a disposable test home.

```bash
pnpm install --frozen-lockfile
pnpm daemon:g1
pnpm dashboard:g1
pnpm daemon:build
pnpm daemon:test:cover && pnpm daemon:cover:check
pnpm dashboard:test:cover && pnpm dashboard:cover:check
pnpm test:l2
pnpm dashboard:e2e --project=dashboard-ui --project=dashboard-embed --project=dashboard-embed-mint
pnpm scan:g2
pnpm scan:d1
```

## Verification

6DQ = unified L1 (absorbing former G1) + L2/L3 + G2 + D1 (test isolation). Status: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
L1 requires statements, branches, functions and lines each ≥95% plus check-only strict analysis/formatting with zero errors/warnings, installed snapshot hooks and proven rejection, with no skipped/focused tests; preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps.
G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 — complete unified contract | planned | Required: all four coverage metrics ≥95%, check-only strict static lanes, installed index-snapshot hook with proven rejection, under 30s. Current gaps: no index-snapshot hook; local pre-commit autofixes instead of check-only; snapshot scope, rejection proof and timing are unverified. Subcheck rows below describe current configuration. |
| L1 subcheck — Go coverage | planned | Hooks/CI gate package statement coverage at 95% with 15 frozen lower floors (69–94%). Other metrics and full 95% remain gaps; do not lower/add baselines. |
| L1 subcheck — TypeScript coverage | planned | Dashboard/shared collect four metrics, but the shell gate checks per-file statements with frozen 82/87 floors and structural exemptions. Require all four 95% without weakening floors. |
| L1 subcheck — static lanes (former G1) | enforced in CI, gap locally | CI runs daemon fmt/vet/golangci-lint and dashboard format/lint/types/dependency boundaries/source checks as check-only gates. Local pre-commit still autofixes staged source, so the local check-only lane is not enforced; unified L1 remains planned. |
| L2 HTTP / CLI | planned | `test:l2` runs five real local daemon/CLI matrices with fake agent backends; `test:l2:embed` checks embedded serving. Complete 100% route/command mapping is not yet enforced. |
| L3 dashboard / CLI | planned | CI runs UI, embed and mint Playwright projects; the dev project and real-agent Chat lane are separate. Require complete page/CLI workflow proof; real providers remain explicitly manual. |
| G2 | enforced | Pre-push/CI scan pnpm/Go dependencies and secrets through OSV, govulncheck and gitleaks. |
| D1 | planned | Homes and DB markers separate test/prod; L2 creates unique child homes. Arbitrary test-home overrides and browser marker-file cleanup lack canonical-path ownership guards; static `scan:d1` alone is insufficient. |

Pre-commit currently runs lint-staged only (Biome/gofmt autofix for source). Pre-push runs vet/types, both coverage gates, L2 and G2 sequentially; it does not build the dashboard. CI supplies broader static/build/L3. Existing hooks do not check index/push-ref snapshots.

Target hooks: pre-commit checks unified L1 (coverage plus static lanes) against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates. The owner merged former G1 into L1 on 2026-09-21; the framework keeps the 6DQ name.

## Resources / Isolation

Use fake backends only with `MEOWTH_TEST=1` and a unique `MEOWTH_TEST_HOME` outside production `~/.meowth`. Test DB is `meowth-test.db` with `_test_marker`; verify ownership before deleting any home. Browser fixtures: 47040/47041 and 17040/17041, separate from dev ports. Real smoke (`test:l2:real`, `dashboard:e2e:real`) can reach external agents; do not use it as an ordinary docs gate.

## Operations / Release

Follow [local services](docs/02-agent-workflow.md) for startup, Caddy routes, build/embed behavior and troubleshooting. Keep versions and generated assets consistent with their owning manifests. Normal Git push does not authorize starting real agent jobs, minting tokens or changing existing user state.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Distinguish the Vite live page from the last daemon-embedded dashboard build.
- Preserve token secrecy in browser screenshots/traces and retain fake-backend test guards.
