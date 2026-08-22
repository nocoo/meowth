# 06 · Experimental Windows (post-merge)

> Status: landed on `main` via PR #1 (`b8a9530`); this document
> records the policy carve-out and the follow-up commits that close
> the merge-review gaps.
> History: `git log -- docs/features/06-experimental-windows.md`

> Parent: [`docs/01-project-overview.md`](../01-project-overview.md) §3 / §6.
> Code: `daemon/internal/store/open.go`, `daemon/internal/initcmd/nonce.go`,
> `daemon/pkg/agent/{copilot,pi,npm}_invocation_windows.go`,
> `scripts/build-daemon.ps1`, `.github/workflows/ci.yml`.

---

## 1. Decision

Meowth stays a **darwin-first** personal tool. Releases, the full 6DQ
matrix, and token-file permission guarantees remain macOS-only.

**Allowed:** a best-effort native Windows path for `init` / `serve`
and `scripts/build-daemon.ps1`. It is unsupported. POSIX `0600` /
`0700` have no ACL equivalent on NTFS.

**Not allowed:** treating Windows as a first-class platform, shipping
windows binaries as a release artifact, or expanding the full CI
matrix onto `windows-latest`.

PR #1 was merged first (author `HH1st`). This document is the
catch-up contract.

## 2. What PR #1 already shipped

| Area | Path | Behaviour |
|---|---|---|
| Build | `scripts/build-daemon.ps1` | dashboard embed + `meowthd.exe` |
| DSN | `store.buildDSN`, `initcmd.buildBootstrapDSN` | drive-letter `C:\…` → `file:///C:/…` |
| Launchers | `*_invocation_windows.go` | `copilot.cmd` / `pi.cmd` → `pwsh -File *.ps1` |
| Docs | `README.md` | experimental PowerShell quick start |

## 3. Follow-up design

### 3.1 Shared file URI helper

One function converts an OS path to a `file:` URI path. Both
`buildDSN` and `buildBootstrapDSN` call it. Package:
`daemon/internal/store` (initcmd already imports store).

### 3.2 Reject non-drive-letter Windows paths

Accepted: `X:\…` / `X:/…` (letter + colon + separator).

Rejected with a hard error (no silent rewrite):

- UNC `\\server\share\…`
- Device `\\?\…`, `\\.\…`
- Relative or drive-relative paths (`C:foo`, `\foo`)

Unix paths are unchanged.

Tests live in `store` and run on darwin by passing an explicit
`goos` into the unexported helper so CI actually executes them.

### 3.3 Narrow compile gate

New CI job on `macos-14`:

```
GOOS=windows GOARCH=amd64 go test -exec true ./...
GOOS=windows GOARCH=arm64 go test -exec true ./...
```

Compile + link only. Does not run Windows binaries. Does not add a
Windows runner.

### 3.4 Launcher scope

This round keeps **copilot + pi only**. claude / codex / hermes stay
on the stock lookup path. A configured `.cmd` / `.bat` is rewritten
to the sibling `<tool>.ps1` next to it; that can skip a custom
wrapper. Known limitation. No extra rewrite until a real caller
needs it.

## 4. Atomic commits (this follow-up)

| # | Commit | Content |
|---|---|---|
| 1 | `docs: allow experimental windows builds` | this file + `docs/01` + indexes |
| 2 | `refactor(store): share windows file uri helper` | one converter, both DSN sites |
| 3 | `fix(store): reject unc windows sqlite paths` | hard error + darwin-runnable tests |
| 4 | `ci: compile daemon for windows goos` | compile-only job |
| 5 | `docs: limit windows npm launcher rewrite` | §3.4 in this file + code comment |

## 5. 6DQ

| Layer | Coverage |
|---|---|
| **L1** | helper + reject cases on darwin; existing windows-tagged tests stay |
| **L2** | unchanged (fake backend, darwin) |
| **L3** | unchanged |
| **G1** | `gofmt` / `go vet` on the shared helper |
| **G2** | no new deps |
| **D1** | unchanged test-home rules |

**SKIPPED:** Windows-hosted CI runner, ACL hardening, UNC support,
claude/codex/hermes `.cmd` rewrite.
