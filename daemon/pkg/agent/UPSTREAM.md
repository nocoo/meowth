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

- **hermes ACP `session/request_permission` reply derived from the
  request's own options array** — `hermes.go` `handleAgentRequest` +
  `pickApprovalOptionID`. Upstream multica replies with a hard-coded
  `{outcome:{outcome:"selected", optionId:"approve_for_session"}}`.
  Hermes ≥ 0.17.0 uses two non-overlapping option sets:
  - `acp_adapter/permissions.py` (generic Shell / agent tools) offers
    `{"allow_once","allow_session","allow_always","deny","deny_always"}`
    and routes anything else to "deny" via `_OPTION_ID_TO_HERMES`.
  - `acp_adapter/edit_approval.py` (file-mutating tools like
    `write_file`) offers ONLY `{"allow_once","deny"}` and requires
    `option_id == "allow_once"` to count as approval.
  A fixed reply breaks one of the two flows. Meowth's hermes client
  now parses `params.options` and picks the first approve-shaped id
  (preference: `allow_session` > `allow_always` > `allow_once` > any
  `allow_*`). Coverage in `TestHermesClientAutoApprovesPermissionRequest`,
  `TestHermesClientAutoApprovesEditApproval`,
  `TestHermesClientCancelsWhenNoApproveOption`, and
  `TestPickApprovalOptionID`. Revisit when pumping multica past the
  commit that adopts an equivalent fix
  (https://github.com/multica-ai/multica `server/pkg/agent/hermes.go`).

- **Codex semantic-inactivity tests widened for slow CI runners** —
  `codex_test.go` `TestCodexExecuteLegacyFirstTurnMessageSatisfiesProgress`,
  `TestCodexExecuteSemanticInactivityAllowsContinuousMessages`, and
  `TestCodexExecuteSemanticInactivityAllowsContinuousDeltaProgress`.
  Upstream uses `SemanticInactivityTimeout` in the 90–150 ms range and
  fixture sleeps in the 50–70 ms range. Because
  `codexFirstTurnNoProgressTimeout()` shrinks the timeout to 80%,
  GitHub-hosted `macos-14` runners regularly hit the watchdog during
  shell scheduling + stdout flush, producing spurious "no progress
  timeout" failures (CI run 27884748048). Meowth widens
  `SemanticInactivityTimeout` to 1 s and each inter-progress sleep to
  ~0.2–0.4 s. Semantic intent preserved: each progress gap stays well
  below the timeout window, and the total turn duration exceeds it,
  which is what proves the watchdog timer is reset on progress events
  rather than that timing is sub-100 ms accurate. Behavior of the
  Codex backend itself is unchanged; revisit when pumping upstream.

## How to pump

See `docs/architecture/01-agent-sdk-pump-from-multica.md` §6.
