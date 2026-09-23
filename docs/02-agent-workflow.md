# Agent workflow and local services

Detailed project constraints and procedures. The root [AGENTS.md](../AGENTS.md) defines the quality contract and records current enforcement gaps.

## Documentation and collaboration

Use numbered `NN-kebab-name.md` files in `docs/`; architecture, features and archive subdirectories have independent numbering and README indexes. Before architecture changes or long tasks, record design, source paths, atomic commit sequence and the 6DQ plan; omit effort estimates. Keep root README and docs indexes current.

State correctness-sensitive assumptions and resolve unclear external effects before acting. Prefer evidence and simple implementations, delete dead code within scope, and write comments only for non-obvious reasons. Keep each commit independently explainable and reversible; explain why. Address the user as 哥 in Chinese conversation; use English code, identifiers and Git messages.

## Local startup and service URLs

**Canonical development URL: https://meowth.dev.hexly.ai**

| Service | Fixed address | Purpose |
|---|---|---|
| Dashboard, API, and HMR | `https://meowth.dev.hexly.ai` | The single browser entry through local Caddy |
| Vite | `http://127.0.0.1:37040` | Frontend source with React Fast Refresh; API proxy to port 7040 |
| Daemon | `http://127.0.0.1:7040` | HTTP API and the last embedded dashboard build |
| Health | `https://meowth.dev.hexly.ai/healthz` | Confirms Caddy can reach the daemon; expected `{"ok":true}` |

Run commands from this repository's root. Check existing listeners first:

```bash
lsof -nP -iTCP:7040 -sTCP:LISTEN
lsof -nP -iTCP:37040 -sTCP:LISTEN
```

Reuse the running daemon and Vite. Start only the missing service in its own
terminal:

```bash
./daemon/meowthd serve   # Daemon: existing local config, 127.0.0.1:7040
pnpm dashboard:dev      # Vite: 127.0.0.1:37040, strictPort enabled
```

- Keep these ports fixed. Resolve an unexpected listener before launching a
  replacement. `--listen-addr` is a daemon test-only flag.
- Normal development uses the existing `$HOME/.meowth/config.toml`, tokens,
  and sessions. `init` is only for a brand-new installation. Keep `MEOWTH_TEST`,
  `MEOWTH_TEST_HOME`, and `MEOWTH_BACKEND_FACTORY=fake` out of normal services.
- Frontend edits through Vite update automatically. Use `pnpm daemon:build`
  when the daemon binary is missing or when preparing an embedded build; it
  builds the dashboard, embeds it, and writes `daemon/meowthd`. The embedded
  page on port 7040 changes when the rebuilt daemon is started.
- The live Caddy configuration is `/opt/homebrew/etc/Caddyfile`: `/v1`,
  `/v1/*`, `/healthz`, `/bootstrap`, and `/bootstrap/*` route to 7040; other
  paths, assets, and HMR WebSockets route to 37040. Use the existing wildcard
  TLS certificate and the single main hostname. `meowth-vite.dev.hexly.ai`
  was retired; the workflow repository's older Caddy template is not the
  source of truth for this machine.
- `MEOWTH_DAEMON_URL` overrides only Vite's proxy target. Its normal value is
  `http://127.0.0.1:7040`; check the shell and `apps/dashboard/.env.local` when
  diagnosing an unexpected backend. Caddy's direct API route stays on 7040.
- First-run token mint uses `http://127.0.0.1:7040/setup`. Existing tokens can
  be pasted into the canonical HTTPS dashboard.
- Browser test ports are separate: UI/dev Vite `47040`, fake dev daemon
  `47041`, embedded fixtures `17040`/`17041`. Real-agent browser tests select
  temporary loopback ports and isolated test homes. These are test fixtures,
  not development entry points.

See [feature 08](../docs/features/08-dashboard-theme-and-vite.md) for routing and
[feature 09](../docs/features/09-chat-workspace-and-ui-polish.md) for Chat and
real-agent verification. [Feature 10](../docs/features/10-chat-reading-and-interaction.md)
records the current Chat layout, tool disclosures, and agent compatibility checks.
Chat and session details share response controls in
`apps/dashboard/src/components/chat/`; see [feature 11](../docs/features/11-session-chat-transcript.md).
