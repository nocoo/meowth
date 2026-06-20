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

## How to pump

See `docs/architecture/01-agent-sdk-pump-from-multica.md` §6.
