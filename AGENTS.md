# Meowth

Local Go daemon/CLI (`daemon/cmd/meowthd`, Go + SQLite) and Vite/React/Basalt web dashboard (`apps/dashboard`, shared types in `packages/shared`) for running and observing installed AI agents.
Docs: [README.md](README.md) · [Overview](docs/01-project-overview.md) · [Docs Index](docs/README.md) · [Local Services](docs/02-agent-workflow.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with pnpm 11.6.0, Go per `daemon/go.mod`, Node 26.12.1 (matching CI), Bash 4+, and installed scanners. Authoritative scripts and manifests live in `package.json`, `pnpm-workspace.yaml`, and `daemon/go.mod`.

```sh
pnpm install --frozen-lockfile
./daemon/meowthd serve         # Local daemon on 127.0.0.1:7040 (reuse if running)
pnpm dashboard:dev             # Vite HMR on 127.0.0.1:37040 (https://meowth.dev.hexly.ai)
pnpm daemon:g1                 # Go fmt check, go vet (S1), golangci-lint (S2)
pnpm dashboard:g1              # TS fmt, Biome lint, tsc (S1), depcruise, source scan (S2)
pnpm test:hooks                # Hook contract tests (S2)
pnpm daemon:build              # Build dashboard and embed into daemon/meowthd (B1)
pnpm daemon:test:cover && pnpm daemon:cover:check          # Go L1 + per-pkg floors
pnpm dashboard:test:cover && pnpm dashboard:cover:check    # TS L1 + per-file floors
pnpm check:l1:ts-four-metrics  # Merged TS 80% four-metric L1 gate (pre-commit)
pnpm test:l2                   # L3 daemon HTTP/CLI matrices (fake backends)
pnpm test:l2:embed             # L3 embedded dashboard serving (after daemon:build)
pnpm dashboard:e2e               # L4 Desktop Chromium core smoke suite (UI + embed + embed-mint)
pnpm scan:g2                   # OSV, gitleaks detect, govulncheck (G1/G2)
pnpm scan:d1                   # Static prod/test home path separation check
```

## Invariants

- Agent processes inherit current user permissions and can call paid models or act externally; daemon tokens grant full access—never expose tokens in logs, screenshots, traces, or fixtures.
- Normal services use existing user config, tokens, and sessions; never rerun `init` or inject `MEOWTH_TEST`, `MEOWTH_TEST_HOME`, or fake backends into them.
- Canonical dev entry is `https://meowth.dev.hexly.ai` (live Caddyfile owns routing and wildcard TLS); reuse daemon `7040` and Vite `37040` after checking listeners ([details](docs/02-agent-workflow.md)).
- Distinguish Vite live dev (`37040`) from the last daemon-embedded dashboard (`7040`); run `pnpm daemon:build` to rebuild and embed dashboard assets into `daemon/meowthd`.
- Keep Go (`daemon/`) outside the pnpm/Turborepo workspace and preserve `apps/dashboard` Model/ViewModel boundaries (`@nocoo/basalt`, Biome); keep versions and generated assets synced with their manifests.
- Preserve existing coverage floors in `scripts/check-*-coverage.sh` without adding new baseline exemptions; close gaps without lowering the contract. Historical test runs are not evidence of a current pass.
- Retain fake-backend test guards and path-isolation checks (`daemon/internal/home`, `daemon/internal/store`); verify ownership before deleting any test home.
- Use numbered design docs with independent subdirectory indexes (`docs/README.md`); long-task plans list code references and quality-slot plans without effort estimates.
- Never bypass Git hooks or use autofix in verification checks; docs edits or routine pushes do not authorize starting real agent jobs, minting tokens, changing user state, or releasing/deploying.

## Quality & Local Gates

Follows `system1-quality`; `S1`–`S3`, `G1`–`G2`, `B1` (including `B1: Build (Windows)`), `L1`, `L3`–`L4` (reusing `B1` `darwin/arm64` daemon artifact), and `Z1` (via `nocoo/base-ci` `z1-gate`) are `enforced` in `.github/workflows/pipeline.yml` -> `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main`, pinned `base-ci` `v2026.24` actions). Local daemon/service only with no CD workflow. Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (not a Worker); `P1 Package` is `N/A` (private, unpublished); real-agent smoke (`test:l2:real`, `dashboard:e2e:real`) is `manual` (opt-in live providers).
- **Coverage**: Go `L1` gates 80% per-package statements with frozen floors (`cmd/`, `store/gen` exempt); TS `L1` gates 80% per-file floors and 80% merged four-metric pre-commit (pure View `.tsx` components and shells/barrels excluded in Vitest config).
- **Local hooks**: installed via `pnpm prepare` (`.husky/`); `pre-commit` blocks partial staging and runs `scripts/hooks/pre-commit-l1.sh` on a `git checkout-index` snapshot (`G1`/`S1`/`S2`/`L1`, ~90–120s warm).
- **Pre-push**: `.husky/pre-push` runs `daemon:vet`, `dashboard:typecheck`, Go/TS `L1` coverage gates, `test:l2` (`L3`), and `scan:g2` (`G1`/`G2`) on the working tree (`planned`: pushed-ref OID scoping).

## Resources & Isolation

| Lane | Endpoint / State | Boundary |
| --- | --- | --- |
| Dev | `https://meowth.dev.hexly.ai` (`7040` daemon, `37040` Vite), `~/.meowth` | Daily user config/tokens/sessions; preserve running listeners, never rerun `init` or inject test env |
| Tests (L3/L4) | `47040`/`47041` (UI/dev), `17040`/`17041` (embed), unique `MEOWTH_TEST_HOME` | Requires `MEOWTH_TEST=1` + `meowth-test.db` (`_test_marker`); fake backends only; verify ownership before delete |
| Real smoke | Temporary loopback ports + disposable test home (`test:l2:real`, `dashboard:e2e:real`) | `manual` opt-in; reaches live external agents; never run as an ordinary docs/PR gate |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and deterministic safeguards to tests or hooks.
