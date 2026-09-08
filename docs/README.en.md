<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="Meowth logo" />
</p>
<h1 align="center">Meowth</h1>
<p align="center">Run local coding CLIs and review their sessions through one web interface and HTTP API.</p>
<p align="center">
  <a href="../README.md">简体中文</a>
</p>

## What it does

Meowth is a coding-agent console for a personal development environment. A local Go daemon connects Claude Code, Codex, GitHub Copilot CLI, Hermes, and Pi to one HTTP API, with the Dashboard embedded in the same binary.

Use the browser to start conversations, follow output, and review sessions, or let trusted scripts call the CLIs through the API. Model requests, authentication, and charges belong to each CLI and its service; Meowth uses the installations and credentials available on the daemon's machine.

macOS is the primary platform. Windows has experimental native builds and `init` / `serve` support, without complete runtime testing or equivalent file-permission guarantees.

## Features

| Task | Current behavior |
| --- | --- |
| Discover agents | Find the five CLIs on PATH and read their versions; finding an executable does not confirm authentication. |
| Start conversations | The Dashboard provides agent selection, streaming replies, expandable tool activity, follow-up turns, and cancellation. |
| Execute through the API | Accept prompts, working directories, models, timeouts, and resume IDs, then return NDJSON events; individual options depend on the backend. |
| Review runs | SQLite stores session status and events, which can be read in the session list and detail pages. |
| Manage access | Create, list, and revoke bearer tokens; a new token's full value is shown only when it is created. |
| Configure remote access | Configuration modes support Tailscale, SSH tunnels, and HTTPS reverse proxies, with transport and access control supplied by those tools. |

Every token grants full API access. Backends start with automatic tool execution enabled and can use the current user's file and command permissions; Meowth does not provide a filesystem sandbox for each project. It is intended for the owner and trusted callers.

## Usage

### Build from source

Install Node.js 24 LTS, the pnpm version specified in `package.json`, and Go 1.26.6 or later as required by `daemon/go.mod`. To start real conversations, install and authenticate at least one supported CLI.

For a new installation:

```bash
git clone https://github.com/nocoo/meowth.git
cd meowth
pnpm install --frozen-lockfile
pnpm daemon:build
./daemon/meowthd init
./daemon/meowthd serve
```

`init` creates `~/.meowth/` and prints an `mwt_...` token once. Save it, open `http://127.0.0.1:7040`, and paste it into the sign-in form. If `~/.meowth/` already contains files, `init` refuses to run; subsequent starts use `serve` with the existing configuration and token.

Check CLI installation on the Dashboard's Agents page, then send a message in Chat. CLI authentication, model availability, and runtime errors still determine whether a conversation succeeds.

On Windows, build with PowerShell from the repository root:

```powershell
pnpm install --frozen-lockfile
.\scripts\build-daemon.ps1
.\daemon\meowthd.exe init
.\daemon\meowthd.exe serve
```

### HTTP calls

Put your saved token in the `MEOWTH_TOKEN` environment variable to list backends. The execution example below needs a working `claude` CLI; replace `cwd` with an existing absolute directory.

```bash
curl -H "Authorization: Bearer $MEOWTH_TOKEN" \
  http://127.0.0.1:7040/v1/agents

curl -N -H "Authorization: Bearer $MEOWTH_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"prompt":"Summarize this project.","cwd":"/absolute/path/to/project","timeout_ms":600000}' \
  http://127.0.0.1:7040/v1/agents/claude/exec
```

Execution requests stream NDJSON until completion. Disconnecting the client cancels the corresponding run. See the [OpenAPI definition](../daemon/internal/server/openapi.yaml) for session queries, cancellation, and token endpoints.

### Data and remote access

The daemon's configuration is `~/.meowth/config.toml`; token digests, sessions, and events are in `~/.meowth/meowth.db`. The server stores Argon2id token digests, while the Dashboard keeps its active token in browser localStorage. Each coding CLI continues to store credentials and sessions according to its own conventions.

The default address is `127.0.0.1:7040`. Before using remote access, select `tailscale`, `ssh_tunnel`, or `https_proxy` under `[remote_access]`, fill in the corresponding address and `acknowledged_by`, then restart the daemon. Settings currently shows status only. Remote modes disable the initial token-mint endpoint, so enable an external proxy or tunnel together with the matching configuration mode. See the [remote-access document](architecture/05-remote-access-modes.md) for fields and deployment examples; the startup command is `meowthd serve`.

## Development

The frontend is in `apps/dashboard/`, shared types are in `packages/shared/`, and the Go daemon is in `daemon/`. Reuse an existing daemon during development. When services need starting, run these in separate terminals:

```bash
./daemon/meowthd serve
```

```bash
pnpm dashboard:dev
```

Vite serves `http://127.0.0.1:37040` and proxies API requests to the daemon on port 7040. Environments with local Caddy routing can also use `https://meowth.dev.hexly.ai`, a local development hostname. `MEOWTH_DAEMON_URL` changes Vite's API target; initial token mint uses `/setup` on the daemon's direct address.

`pnpm daemon:build` rebuilds the Dashboard and embeds it in the Go binary. The page on port 7040 updates when the new binary starts. See the [Vite and theme document](features/08-dashboard-theme-and-vite.md) for frontend development details.

## Tests

After installing dependencies, run these from the repository root:

| Scope | Command |
| --- | --- |
| Go unit and package tests | `pnpm daemon:test` |
| Dashboard and shared-type unit tests | `pnpm dashboard:test` |
| Local HTTP integration tests | `pnpm test:l2` |
| HTTP integration for the embedded page | Run `pnpm daemon:build`, then `pnpm test:l2:embed` |
| Browser tests | Run `pnpm --filter @meowth/dashboard e2e:install`, then `pnpm dashboard:e2e` |

Regular integration and browser tests use separate test directories, local test ports, and simulated backends. Real CLI tests need working authentication and model services and make actual model requests. Run them as needed:

```bash
MEOWTH_REAL_BACKENDS_L2=1 pnpm test:l2:real
MEOWTH_REAL_CHAT=1 pnpm dashboard:e2e:real
```

## Stack

| Technology | Role |
| --- | --- |
| Go / Chi | Daemon, HTTP routing, and CLI subprocess management |
| SQLite / sqlc | Local tokens, sessions, and event data |
| React / TypeScript / Vite | Dashboard and development server |
| Basalt / Tailwind CSS | Components, themes, and styling |
| React Markdown / remark-gfm | Chat and session message rendering |
| pnpm / Turborepo | Frontend workspaces and build orchestration |
| Go testing / Vitest / Playwright | Package, UI unit, and browser tests |

## Documentation

- [Documentation index](README.md)
- [Project purpose and design background](01-project-overview.md)
- [HTTP protocol and endpoints](architecture/02-daemon-http-protocol.md)
- [Initialization and first token](architecture/04-bootstrap-and-first-run-mint.md)
- [Chat and session transcripts](features/11-session-chat-transcript.md)
- [Experimental Windows support](features/06-experimental-windows.md)
- [Changelog](../CHANGELOG.md)

## License

Original code is licensed under [MIT](../LICENSE). `daemon/pkg/agent/` comes from [Multica](https://github.com/multica-ai/multica) and retains its [Modified Apache 2.0 license](../daemon/pkg/agent/LICENSE). See [UPSTREAM.md](../daemon/pkg/agent/UPSTREAM.md) for provenance and local changes, and read the additional terms when using that code.
