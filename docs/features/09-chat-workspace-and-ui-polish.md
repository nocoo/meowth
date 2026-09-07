# 09 · Chat workspace and dashboard polish

> Status: in progress (2026-09-08).
> References: Basalt `INTEGRATION.md`, its Chat page, and the installed
> `@nocoo/basalt@2.1.0` chat components.

## Design

1. Keep `https://meowth.dev.hexly.ai` as the only configured HTTPS development
   entry. Remove the old Vite hostname from Caddy and Vite's host allowlist.
   Frontend, API, and WSS hot refresh continue through the main origin.
2. Use sentence case for visible labels and statuses: `Completed`, `Tool
   result`, and `Local daemon`. Preserve API values, code, identifiers, and
   product spellings such as `GitHub`, `Claude`, `Codex`, and `Pi`.
3. Center the collapsed sidebar's brand, navigation icons, expand button, and
   footer on the same rail axis. Verify actual browser bounds after collapse.
   Remove the global refresh action and its unused registration infrastructure.
4. Rebuild Chat using Basalt's `ChatHeader`, `ChatInbox`, `ChatBubble`, and
   `ChatComposer`. Use a responsive conversation list, a restrained agent
   header, a readable message column, and a fixed composer. Conversation state,
   execution, retries, cancellation, and backend resume IDs stay in the
   viewmodel/model layers. Preserve messages when switching conversations.
5. Render assistant Markdown with `react-markdown` and `remark-gfm`, using
   Basalt code surfaces and controls. Support headings, emphasis, fenced and
   inline code, lists, quotes, tables with column alignment, and safe links.
   Raw HTML remains escaped; code/tool/log output remains literal. Keep the
   existing CSP and never add an HTML injection path. This supersedes the
   plain-text-only chat presentation in feature 03 and feature 08.
6. Support copyable code/responses, visible stream/stop/error states, retry,
   and conversation follow-up. Follow new output only while the reader is
   near the bottom; offer a jump control after they scroll away. Keep long
   code and tables inside the message column, including on narrow screens.

## Code references

| Area | Files |
|---|---|
| Development entry | `apps/dashboard/vite.config.ts`, feature 08, local Caddyfile |
| Dashboard chrome | `apps/dashboard/src/components/layout/`, `components/SessionStatusBadge.tsx`, `pages/` |
| Chat presentation | `apps/dashboard/src/pages/Chat/`, `components/MessageText.tsx`, new Markdown renderer |
| Chat state/transport | `apps/dashboard/src/viewmodels/useChatViewModel.ts`, `models/chat.ts`, `models/agents.ts` |
| Browser validation | `apps/dashboard/e2e/`, `apps/dashboard/playwright.config.ts`, real-agent opt-in harness |

## Atomic commit plan

1. `docs: plan chat workspace and ui polish` — this design and indexes.
2. `fix: use one dashboard development hostname` — current routing, Vite
   allowlist, documentation, and focused HTTPS/WSS verification.
3. `fix: normalize dashboard labels and rail` — sentence case and collapsed
   geometry, with browser regression coverage.
4. `chore: remove redundant page refresh control` — remove the action and
   dead refresh wiring; preserve refresh operations still used by mutations.
5. `feat: render rich chat messages safely` — Markdown, code/copy controls,
   coherent typography, and rendering/security tests.
6. `feat: rebuild chat with basalt components` — template integration,
   conversations, stream controls, responsive layout, and interaction tests.
7. `test: verify chat with installed agents` — opt-in real-agent browser
   verification and recorded results. Split any discovered adapter fixes into
   their own tested commits.

## 6DQ quality plan

| Dimension | Validation |
|---|---|
| L1 | Meaningful Markdown safety/format tests; conversation switching, resume, retry, cancellation, and stale-stream isolation; existing suite and coverage gate. |
| L2 | Real installed Claude, Copilot, Codex, Hermes, and Pi through the production daemon factory; require terminal status and actual response content. |
| L3 | Desktop/mobile and light/dark review; measure rail alignment; keyboard input/composition, stop/retry, copy, scrolling, rich content, and trusted HTTPS HMR. |
| G1 | Biome, TypeScript, dependency boundaries, source scan, production build, and relevant embedded browser tests. |
| G2 | No raw HTML evaluation; check malicious Markdown/URLs and literal code; maintain CSP. Inspect new Markdown dependencies. |
| D1 | Real-agent tests use an isolated daemon test home and fresh fixture bearer. Reuse installed CLI authentication without printing credentials. Prompts request harmless formatting samples without tools or file edits. Keep normal daemon data and other running sessions untouched. |

Real agents use the user's existing configured providers and can incur normal
model usage. Record installed-but-unavailable agents as failures with their
actual reason; do not count synthetic responses as live-agent verification.

## Results

- Single HTTPS origin complete. Caddy candidate validation/reload, main-origin
  API health, trusted WSS CSS update, document/draft preservation, TypeScript,
  and production build passed. The retired hostname no longer serves the
  dashboard; Vite rejects its Host header with HTTP 403.
- UI and chat implementation pending.
