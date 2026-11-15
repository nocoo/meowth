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
- Use numbered design docs, independent directory indexes and atomic commits; long-task plans include code references and quality slot plans without effort estimates. Preserve existing coverage floors; add no new exceptions.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Daemon | `daemon/cmd/meowthd`, Go + SQLite |
| Dashboard | `apps/dashboard`, Vite/React/Basalt |
| Shared / build | `packages/shared`, pnpm/Turborepo/Biome |

## Commands

Run from root with pnpm 11.6.0, the Go toolchain in `daemon/go.mod` (1.26.6), Node matching CI 26.12.1, Bash 4+ and installed scanners. Ordinary L2 uses fake backends; real-agent lanes are opt-in and require a disposable test home.

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

Quality follows `system1-quality` (12 slots `S1..Z1` in `.github/workflows/quality-slots.yml`, `nocoo/base-ci v2026.15` for pinned actions). Statuses: `impl`, `na`, `manual`, or `planned`.

| Slot | Status | Implementation / Evidence |
| --- | --- | --- |
| S1: Typecheck | impl | `pnpm dashboard:typecheck` and `pnpm daemon:vet` |
| S2: Lint | impl | `pnpm test:hooks`, `daemon:fmt:check`/`lint`, `dashboard:fmt:check`/`lint`/`depcruise`, `scan:dashboard-source` |
| S3: Workflow Lint | impl | `actionlint`, immutable `nocoo/base-ci` SHA check, and `yamllint` |
| G1: Secret Scan | impl | `pnpm scan:gitleaks:detect` (and staged gitleaks in pre-commit) |
| G2: Dependency Vulnerabilities | impl | `pnpm scan:osv` and `pnpm scan:govulncheck` |
| B1: Build | impl | `pnpm daemon:build` (`darwin/arm64` and `darwin/amd64`) |
| L1: Unit Tests & Coverage | impl | `daemon:test:cover` + `daemon:cover:check` (per-pkg 95% with frozen floors); `dashboard:test:cover` + `dashboard:cover:check` (merged TS branches `93.97%` vs `95%` floor) |
| L2: Runtime | na | Not a Cloudflare Worker project |
| L3: Integration | impl | `pnpm test:l2` (daemon HTTP/CLI matrices with fake backends) and `pnpm test:l2:embed` |
| L4: E2E | impl | Playwright (`dashboard-ui`, `dashboard-embed`, `dashboard-embed-mint`) |
| P1: Package Check | na | Private packages; not published to npm |
| Z1: Gate | impl | Aggregates all 11 slots + `compile-windows` and verifies `tested-sha` |

Pre-commit enforces L1 on a `git checkout-index` snapshot via `scripts/hooks/pre-commit-l1.sh` (~90–120s warm). Pre-push runs vet/types, package coverage gates, L3 (`test:l2`), and G1/G2 (`scan:g2`). CI supplies all macOS native slots + `compile-windows`.

Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

Use fake backends only with `MEOWTH_TEST=1` and a unique `MEOWTH_TEST_HOME` outside production `~/.meowth`. Test DB is `meowth-test.db` with `_test_marker`; verify ownership before deleting any home. Browser fixtures: 47040/47041 and 17040/17041, separate from dev ports. Real smoke (`test:l2:real`, `dashboard:e2e:real`) can reach external agents; do not use it as an ordinary docs gate.

## Operations / Release

Follow [local services](docs/02-agent-workflow.md) for startup, Caddy routes, build/embed behavior and troubleshooting. Keep versions and generated assets consistent with their owning manifests. Normal Git push does not authorize starting real agent jobs, minting tokens or changing existing user state.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Distinguish the Vite live page from the last daemon-embedded dashboard build.
- Preserve token secrecy in browser screenshots/traces and retain fake-backend test guards.
