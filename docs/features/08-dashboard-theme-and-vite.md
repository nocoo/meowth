# 08 · Dashboard theme consistency and Vite development

> Status: complete (2026-09-08).
> Reference: Basalt `INTEGRATION.md` sections 2, 5, 7, and 14; installed `@nocoo/basalt@2.1.0`.

## Problem

The package migration left two independent design systems in the dashboard.
`src/index.css` still defines the original unprefixed colors, while Basalt
components use `--basalt-*`. Local pages, navigation, notices, and chat therefore
disagree with library controls. A dark-mode `!important` override also bypasses
the accent provider's contrast calculation. Sidebar groups add an extra gutter.

The Go daemon serves a compiled, embedded dashboard at port 7040. Vite already
runs separately at port 37040, with API proxies and origin-relative HMR. These
are different delivery modes, not different frontend frameworks.

## Design

1. Use Basalt as the only surface, type, border, and accent source. Replace
   unprefixed utilities, remove the copied token sheet and unused palette, and
   let `AccentProvider` resolve readable Meowth blue in both themes.
2. Follow the rail's single-gutter geometry. Keep the brand mark stationary
   when collapsed, normalize Lucide icons to 16px / 1.5 stroke, and use shared
   controls for header actions. Use high-resolution existing logo assets.
3. Review Overview, Agents, Chat, Sessions/detail, Tokens/dialogs, Settings, and
   Setup. Align spacing, metadata contrast, status treatments, empty/loading
   states, and message wrapping. Use Basalt surfaces instead of arbitrary fills.
   Agent output remains escaped text; the application has no image/video player.
4. Serve the normal `meowth.dev.hexly.ai` frontend through Vite, preserving that
   hostname's browser login. Caddy sends API requests directly to the daemon.
   Provide a root development script, configurable Vite proxy target, and
   startup documentation. Preserve the embedded build and loopback-only mint.
5. Keep route names, auth, API contracts, and MVVM responsibilities intact.

## Development routes

| Entry | Frontend | API |
|---|---|---|
| `https://meowth.dev.hexly.ai` | Caddy to Vite `127.0.0.1:37040` | Caddy to daemon `127.0.0.1:7040` |
| `http://127.0.0.1:37040` | Vite directly | Vite proxy to daemon |
| `http://127.0.0.1:7040` | Embedded production build | Daemon directly |

`pnpm dashboard:dev` starts only the frontend. Reuse the running daemon, or
start `./daemon/meowthd serve` in another terminal. `pnpm dev` also runs Vite.
The development server uses a strict loopback port and accepts only the main
HTTPS hostname. Its HMR client derives WS/WSS from the browser origin.

`MEOWTH_DAEMON_URL` sets the Vite proxy target, defaulting to
`http://127.0.0.1:7040`. Vite reads it from the shell or dashboard `.env.local`;
Turborepo passes it through for `pnpm dev`. It is not exposed as a browser
environment variable. `/v1` and `/healthz` preserve the incoming Host header.
Bootstrap mint is never proxied by Vite; first-run mint uses the daemon's
direct HTTP loopback URL.

### Local Caddy routing

The local `/opt/homebrew/etc/Caddyfile` uses this Meowth block. The existing
wildcard certificate and DNS already cover the hostname.

```caddyfile
http://meowth.dev.hexly.ai {
    redir https://meowth.dev.hexly.ai{uri} permanent
}
meowth.dev.hexly.ai {
    tls /Users/nocoo/workspace/personal/workflow/certs/cert.pem /Users/nocoo/workspace/personal/workflow/certs/key.pem
    @daemon path /v1 /v1/* /healthz /bootstrap /bootstrap/*
    handle @daemon {
        reverse_proxy 127.0.0.1:7040
    }
    handle {
        reverse_proxy 127.0.0.1:37040
    }
}
```

Validate the candidate configuration with `caddy validate --adapter caddyfile
--config <path>` before applying it, then gracefully reload with
`caddy reload --adapter caddyfile --config /opt/homebrew/etc/Caddyfile`.
The `/bootstrap` matcher preserves the daemon's own rejection of mint requests
through a proxy; it does not enable mint on the HTTPS hostname.

The separate Vite hostname was retired on 2026-09-08. The main hostname is the
only configured HTTPS entry for the dashboard, API, and hot refresh.

### Isolated browser tests

| Project | Vite | Daemon | Data |
|---|---|---|---|
| `dashboard-ui` | `47040` | None | Intercepted synthetic API responses |
| `dashboard-dev` | `47040` | `47041` | Temporary test home and fake backends |
| `dashboard-embed` | None | `17040` | Temporary test home, existing test token |
| `dashboard-embed-mint` | None | `17041` | Temporary test home, fresh mint window |

The UI and dev projects share one test Vite server when selected together.
All test servers use `reuseExistingServer: false`; the normal daemon and Vite
remain available. The HMR test imports a temporary CSS module under the ignored
`.playwright` directory, changes a computed property, and checks that the
document and unsent chat draft survive. Vite excludes `test-results` from its
watcher, so the probe must live outside that directory.

CI runs `dashboard-ui`, `dashboard-embed`, and `dashboard-embed-mint`. The
existing CI exclusion of `dashboard-dev` remains due to its historical init
flakiness; it is also verified locally for this change.

## Code references

| Area | Files |
|---|---|
| Theme | `apps/dashboard/src/index.css`, `components/basalt-providers.tsx` |
| Chrome | `apps/dashboard/src/components/layout/{app-shell,sidebar,refresh-button}.tsx` |
| Content | `apps/dashboard/src/pages/`, `components/{StatCard,MessageText}.tsx`, `components/ui/` |
| Runtime | `apps/dashboard/vite.config.ts`, root `package.json`, `turbo.json`, `README.md` |
| Browser checks | `apps/dashboard/playwright.config.ts`, `apps/dashboard/e2e/` |

## Atomic commit plan

1. `docs: plan dashboard theme and vite cleanup` — this design and indexes.
2. `fix: unify dashboard colors with basalt` — remove competing tokens and
   migrate all consumers, including semantic output and related checks.
3. `fix: align dashboard layout and content` — rail, header, page content,
   logo rendering, responsive behavior, and meaningful browser regressions.
4. `fix: restore focus after token dialogs` — use Basalt's native dialog
   trigger so Cancel and Escape return keyboard focus to the opener.
5. `chore: remove obsolete dashboard styles` — remove the unused animation
   package and palette exclusions; update adapter provenance.
6. `feat: enable vite dashboard hot refresh` — executable development entry,
   isolated browser verification, startup documentation, and validation record.

Each implementation commit includes its applicable checks. Further splits are
allowed when changes can be independently verified.

## 6DQ quality plan

| Dimension | Validation |
|---|---|
| L1 | Existing dashboard/shared unit suite and coverage gate; update obsolete style assertions without weakening behavior checks. |
| L2 | Verify API proxy responses and streaming through Vite; no Go API changes. |
| L3 | Playwright page audit in light/dark and desktop/mobile; navigation, token dialog, chat output, setup, embedded security tests, and real HMR connection/update. |
| G1 | Dashboard format, lint, types, dependency boundaries, source scan, and production build. |
| G2 | No added runtime packages or remote assets; preserve CSP and escaped message rendering. |
| D1 | Browser fixtures use mock API data or isolated test daemon homes; never modify the running user's tokens/sessions. |

## Results

- The dashboard now uses only Basalt colors/surfaces. The sidebar has one
  gutter, consistent 16px/1.5 icons, and a stationary high-resolution mark.
- Overview shows recent sessions and agent availability using its existing
  viewmodel data. Pages share spacing and readable metadata; tables scroll
  locally, while prose and long output wrap within the viewport.
- Chat uses sans-serif prose and monospace code, Basalt InputArea, an actionable
  New chat control, and composition-aware Enter handling for Chinese input.
- Token dialogs restore focus on Cancel/Escape through Basalt's DialogTrigger.
  Secret state is still cleared immediately on close.
- L3: 10 UI browser tests and 17 dev/embedded browser tests passed. Embedded
  coverage includes authentication, first-run mint, exec/session rendering,
  CSP/security headers, XSS escaping, and secret reveal lifecycle. The exact
  CI project selection also passed locally (22 cases).
- A separate audit of 26 desktop/mobile light/dark page scenarios through the
  normal HTTPS hostname found no page overflow, broken images, or JS errors.
- HTTPS HMR was verified through a trusted browser connection to
  `wss://meowth.dev.hexly.ai`: an actual CSS edit updated the page while its
  document sentinel and unsent chat draft remained intact. The API health
  endpoint still returned `{ "ok": true }` through Caddy.
- Caddy was backed up, validated, and gracefully reloaded. Certificates and
  existing daemon/Vite processes were reused. The direct daemon entry still
  serves the embedded build.
- L1: 503 dashboard tests and 1 shared test passed. Dashboard statement/line
  coverage is 94.47%; the coverage gate passed with its three existing baseline
  floors intact.
- G1: formatting, lint, TypeScript, dependency boundaries, and dashboard source
  scan passed. TypeScript now includes the Playwright configuration and E2E
  tests. The production build passed; its existing >500 kB chunk advisory remains.
- G2: no runtime dependency was added. The unused `tw-animate-css` package was
  removed with an offline install, and embedded CSP/XSS tests passed.
- D1: the production/test path scan passed. Browser fixtures used isolated
  temporary homes or synthetic API data throughout verification.
