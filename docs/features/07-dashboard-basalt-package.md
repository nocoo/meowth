# 07 · Dashboard migrate to `@nocoo/basalt` 2.1.0

> Status: in progress.
> History: `git log -- docs/features/07-dashboard-basalt-package.md`
> Companion: [`architecture/06`](../architecture/06-dashboard-mvvm-and-basalt.md) (MVVM + chrome contract), [`02`](./02-dashboard-redesign-to-basalt-gen2.md) (Gen 2 shell), [`04`](./04-dashboard-control-alignment.md) (local primitives), [`05`](./05-dashboard-visual-align-whiteboard.md) (logo / island / chat chrome).
> Upstream: `~/workspace/personal/basalt/INTEGRATION.md`, catalog https://basaltui.com, live consumer `~/workspace/personal/zhe` (`@nocoo/basalt@2.1.0`).

---

## 1. Intent

Meowth dashboard already looks like Basalt (Gen 2 rail, floating island, four luminance steps) but **does not import the published package**. Chrome and leaves are source-copied / locally rewritten (`apps/dashboard/src/components/ui/*`, `components/layout/*`, `index.css` token sheet). That fork drifts from `@nocoo/basalt` and duplicates primitives the library now owns.

Replace the local chrome and common controls with `@nocoo/basalt@2.1.0`. Keep every product behaviour: setup mint / token paste, AuthGate, refresh, GitHub link, Chat full-page (no FAB), token create/revoke, SecretReveal. Visual drift from control swap is allowed. Semantic labels, routes, and auth must not change.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | Pin `@nocoo/basalt@2.1.0` on `@meowth/dashboard`. Do not range (`^`). Confirmed latest on `https://mirrors.tencent.com/npm/` (2026-09-07). |
| D2 | CSS follows INTEGRATION.md: `@source` → `@import "@nocoo/basalt/styles/tailwind"` → `@import "tailwindcss"`. Do not re-declare `--basalt-*`. |
| D3 | Brand accent is Meowth blue: `AccentProvider` `paletteOverrides.primary = { light: "217 91% 60%", dark: "217 91% 65%" }`, `defaultAccent="primary"`, `persist={false}`. |
| D4 | `ThemeProvider` with `storageKey="meowth_theme"` so existing light/dark preference survives. Drop the hand-rolled `ThemeToggle.tsx` once Basalt's toggle is wired. |
| D5 | Setup stays **outside** `AppShell`. Restyle to the INTEGRATION.md visitor-badge card. Token paste / mint / error / mint-disabled copy and form names stay. |
| D6 | Shell uses Basalt `AppShell` / `AppSkipLink` / `AppMain` / `AppHeader` / `ContentIsland` / `Sidebar*`. App owns nav data, `/logo-24.png`, version pill, GitHub + Refresh + ThemeToggle. |
| D7 | Collapsed logo **does not move**. Keep `h-14 pl-6 pr-3 justify-start` (features/05 D1 / zhe). Do **not** center the mark (`justify-center`) even though INTEGRATION.md's collapsed recipe does. |
| D8 | No FAB. Chat stays a full route inside the island (`overflow-hidden p-0` on `/chat`). |
| D9 | Product-only widgets (`SecretReveal`, `MessageText`, `StatCard`, Chat bubbles / composer / AgentPicker, `RefreshButton`) stay, wrapped as local components that consume Basalt leaves. |
| D10 | Delete local `components/ui/*` once zero call sites remain. Delete `radix-ui` / `class-variance-authority` from dashboard deps if nothing else imports them. MVVM (`pages/` / `viewmodels/` / `models/`) is unchanged. |
| D11 | AuthGate probing uses Basalt `LoadingScreen`. Unreachable state uses a Basalt `LayerCard` + `Button`. Probe / 401 / redirect contract is untouched. |

## 3. Outside-in replacement order

INTEGRATION.md MVP order. Each stage is independently committable and test-green.

1. **Providers + CSS** — `ThemeProvider` / `AccentProvider` / `LinkProvider` / `TooltipProvider` / `Toaster` around the router. Pre-hydration theme script in `index.html` matching `meowth_theme`.
2. **Login / Setup** — badge card on `/setup`.
3. **App frame** — skip link, rail, header (crumbs + current page + GitHub / Refresh / ThemeToggle), island.
4. **Pages** — `PageHeader` then `SectionRule` / `LayerCard`, then leaves (`Button`, `Input`, `Select`, `Dialog`, `Table`, `Badge`, `EmptyState` / equivalent, `Skeleton`).

### 3.1 Who owns what (after)

| Layer | Component | Path |
|---|---|---|
| Providers | app-owned tree | `apps/dashboard/src/components/basalt-providers.tsx` |
| Login | Setup badge, not AppShell | `apps/dashboard/src/pages/Setup/SetupPage.tsx` |
| Rail | Basalt `Sidebar*` + Meowth nav | `apps/dashboard/src/components/layout/sidebar.tsx` |
| Frame | Basalt `AppShell` / `AppHeader` / `ContentIsland` | `apps/dashboard/src/components/layout/app-shell.tsx` |
| Page heading | Basalt `PageHeader` | page shells under `apps/dashboard/src/pages/` |
| Cards | Basalt `LayerCard` | page contents + `StatCard` |
| Specials | local wrappers | `SecretReveal`, `MessageText`, Chat `*`, `RefreshButton` |

`LinkProvider.render` maps internal `href` to React Router `Link`; `http(s):` / `mailto:` / `tel:` stay `<a>`.

## 4. Code

| Area | Path |
|---|---|
| Package | `apps/dashboard/package.json`, `pnpm-lock.yaml` |
| CSS | `apps/dashboard/src/index.css`, `apps/dashboard/src/__tests__/index.css.test.ts` |
| Entry | `apps/dashboard/index.html`, `apps/dashboard/src/main.tsx`, `apps/dashboard/src/App.tsx` |
| Providers | `apps/dashboard/src/components/basalt-providers.tsx` (new) |
| Setup | `apps/dashboard/src/pages/Setup/SetupPage.tsx` + tests |
| Auth | `apps/dashboard/src/components/AuthGate.tsx` + tests |
| Shell | `apps/dashboard/src/components/layout/{app-shell,sidebar,breadcrumbs}.*` |
| Pages | `apps/dashboard/src/pages/{Overview,Agents,Sessions,Tokens,Settings,Chat}/*` |
| Architecture | `docs/architecture/06-dashboard-mvvm-and-basalt.md` — stop saying source-copy; record npm import |
| Provenance | `apps/dashboard/src/_UPSTREAM.md` — replace copy tables with package pin |

Keep: `lib/api.ts`, all `viewmodels/` / `models/`, `lib/localStorage.ts` token key, mint origin gate, CSP / XSS (`architecture/07`).

## 5. Atomic commits

1. `docs: plan dashboard basalt 2.1.0 migrate`
2. `chore: add @nocoo/basalt 2.1.0 dependency`
3. `feat: wire basalt css providers and accent`
4. `feat: restyle setup page as basalt badge`
5. `feat: swap appshell to basalt chrome`
6. `feat: swap sidebar to basalt rail`
7. `feat: use basalt pageheader and layercard`
8. `feat: replace local ui leaves with basalt`
9. `feat: wrap leftover meowth-only widgets`
10. `chore: drop unused local ui primitives`
11. `docs: record npm basalt in architecture 06`
12. `test: retarget dashboard tests at basalt`

Split further if a step is not independently green. Do not mix CSS-token deletion with a page rewrite.

## 6. 6DQ

| Dim | Plan |
|---|---|
| L1 | Existing page / layout / Setup / AuthGate / ThemeToggle tests stay; update selectors that pin local class names (`bg-card`, `data-slot="notice"`, heading level). VM / model tests unchanged. New provider file gets a small render test (accent default, LinkProvider internal vs external). Coverage gate still applies. |
| L2 | No daemon / HTTP change. Skip. |
| L3 | Playwright `dev` / `embed` / `embed-mint` stay green. Setup copy, token create dialog name, Chat `Send` / `Cancel` / `Message` names, SecretReveal flow must still match. |
| G1 | `pnpm dashboard:g1` (biome, lint, tsc, depcruise, source-scan). Depcruise rules stay MVVM-only; Basalt imports are allowed from pages/components. |
| G2 | New npm package; `pnpm scan:osv` after lockfile change. |
| D1 | No SQLite / test-home change. Skip. |

Skip: daemon Go tests, L2 HTTP scripts, remote-access modes.

## 7. Out of scope

- Changing mint origin gate or Caddy domains.
- Adding a command palette / FAB / accent picker UI.
- Bumping dashboard app version / CHANGELOG (separate release).
- Rewriting Chat protocol or viewmodels.
