# 08 · Dashboard theme consistency and Vite development

> Status: in progress (2026-09-08).
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
4. Verify Vite directly and through the existing HTTPS development hostname.
   Provide explicit root scripts and startup documentation for frontend work.
   Preserve the production embedded build and the loopback-only mint flow.
5. Keep route names, auth, API contracts, and MVVM responsibilities intact.

## Code references

| Area | Files |
|---|---|
| Theme | `apps/dashboard/src/index.css`, `components/basalt-providers.tsx` |
| Chrome | `apps/dashboard/src/components/layout/{app-shell,sidebar,refresh-button}.tsx` |
| Content | `apps/dashboard/src/pages/`, `components/{StatCard,MessageText}.tsx`, `components/ui/` |
| Runtime | `apps/dashboard/vite.config.ts`, root `package.json`, `README.md` |
| Browser checks | `apps/dashboard/playwright.config.ts`, `apps/dashboard/e2e/` |

## Atomic commit plan

1. `docs: plan dashboard theme and vite cleanup` — this design and indexes.
2. `fix: unify dashboard colors with basalt` — remove competing tokens and
   migrate all consumers, including semantic output and related checks.
3. `fix: align dashboard layout and content` — rail, header, page content,
   logo rendering, responsive behavior, and meaningful browser regressions.
4. `feat: clarify vite dashboard development` — executable development entry,
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

Pending implementation and browser verification.
