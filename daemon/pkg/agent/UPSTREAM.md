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

(This file is created at vendor time; the trim list will be enforced by the
follow-up Phase 3.2 commit `feat(daemon): trim agent SDK to 5 whitelisted backends`.
At this commit (Phase 3.1), the 8 trimmed providers are still present.)

## How to pump

See `docs/architecture/01-agent-sdk-pump-from-multica.md` §6.
