# Upstream

This package is vendored verbatim from multica `server/pkg/agent`.

| Field           | Value |
|-----------------|-------|
| source_repo     | https://github.com/multica-ai/multica.git |
| source_path     | server/pkg/agent/ |
| commit_sha      | 4bbaf5363c5ddf1e3087b50f587dfae06f113b34 |
| vendored_at     | 2026-06-20 |
| vendor_method   | local shallow clone + git archive <sha> (see docs/architecture/01 §3.1) |
| license         | Modified Apache 2.0 (see daemon/pkg/agent/LICENSE) |
| notice          | none on upstream as of 4bbaf5363c5ddf1e3087b50f587dfae06f113b34 |
| local_patches   | see commit log: `git log -- daemon/pkg/agent` |

## Trimmed providers

Removed at Phase 3.2 to keep V1 whitelist (claude, copilot, codex, hermes, pi):

- antigravity
- codebuddy
- cursor
- gemini
- kimi
- kiro
- openclaw
- opencode

(The trim was applied in `feat(daemon): trim agent SDK to 5 whitelisted backends`
(Phase 3.2; see `git log -- daemon/pkg/agent` for the exact commit). The listed
providers are removed from the current tree; the file map under §4.2 of
`docs/architecture/01-agent-sdk-pump-from-multica.md` records the exact
deletions, and `TestSupportedTypesMatchesMeowthWhitelist` /
`TestNewFactoryWhitelist` guard against accidental reintroduction on future
pumps.)

## Local fixes on top of upstream

These are meowth-local divergences from the vendored upstream beyond the
trim. Each one needs to be revisited when pumping to a newer multica SHA:
either the upstream has merged an equivalent fix (drop the local patch) or
it still hasn't (keep the patch and verify the affected path still applies).

- **pi `message_end` / `turn_end` error mapping** — `pi.go`. Upstream
  treats Pi runs as `Status="completed"` whenever the child exits 0,
  including when the upstream provider returned an API error mid-turn
  (Pi emits `message_end` with `stopReason="error"` + `errorMessage` and
  still exits 0). Meowth surfaces these as `Status="failed"` with the
  upstream error text in `Result.Error`, because otherwise the daemon
  reports a successful agent run that produced no assistant output —
  which the multi-agent review of P5 confirmed was a real false-positive
  smoke pass. See `fix(agent): surface pi message_end errors` and its
  three `TestPi…` cases in `pi_test.go`.

- **pi session dir/file mode hardening** — `pi.go` `ensurePiSessionFile`.
  Upstream creates the Pi session directory with `0o755` and the session
  file with `0o644` (world-readable). Meowth tightens these to `0o700` /
  `0o600` so the per-user Pi session content is not world-readable on
  a shared `$HOME`. Behavior is otherwise unchanged. Applied alongside
  the Phase 2.3 lint wiring; revisit when pumping if upstream tightens
  the same call sites.

## How to pump

See `docs/architecture/01-agent-sdk-pump-from-multica.md` §6.
