# 09 · Chat workspace and dashboard polish

> Status: complete (2026-09-08).
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
   The workspace is in memory while Chat is open; daemon runs remain saved
   in Sessions. The conversation drawer is used below 1100px.
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
8. `docs: pin local startup ports and hostname` — record the verified startup
   commands, canonical URL, fixed ports, and service reuse rules in root
   `CLAUDE.md`, as requested during implementation.

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
- Labels now use sentence case across agent lists, sessions, and chat status
  output. Collapsed navigation uses a static class string: Radix tooltip slot
  composition previously stringified the `NavLink` callback and lost `flex`,
  moving each icon 12px off the rail axis. Light/dark browser geometry checks
  now pass with all rail marks centered. Existing unit assertions were updated
  for the visible labels; underlying API values remain unchanged.
- Global refresh control, provider, and page registration hooks removed.
  Failed requests retain a contextual Retry action. The affected page/shell
  unit tests (41), light/dark rail browser checks (2), TypeScript, and build
  passed.
- Rich assistant output now supports GFM formatting and table alignment, with
  Basalt code surfaces, syntax colors, language labels, and exact code copying.
  Raw HTML stays literal, unsafe links are inert, and Markdown images become
  links so agent output cannot silently fetch remote images outside the CSP.
  ANSI controls are stripped from Markdown; terminal/tool output retains its
  escaped ANSI renderer. Clipboard failures remain retryable.
- Markdown/ANSI/message unit checks (60), rich output/copy browser checks in
  light/dark desktop/mobile (4), TypeScript, source scan, and production build
  passed. OSV reported no vulnerabilities across the 96 added package versions.
  The existing OpenAPI generator's TypeScript 5 peer range still disagrees with
  the project's installed TypeScript 7; the Markdown packages have no peer gap.
- Chat now uses all four Basalt chat components with a searchable conversation
  list, compact drawer, bounded message column, and fixed composer. Switching
  conversations preserves their agent, messages, and terminal resume IDs;
  active streams continue in their owning conversation. Stop is immediate,
  stale responses cannot overwrite a retry, and transport errors remain
  distinguishable from daemon terminal statuses.
- A browser regression exposed a Basalt 2.1.0 composer bug: stopping could
  change the same DOM button to `type=submit` before click activation ended,
  sending the next draft. `patches/@nocoo__basalt@2.1.2.patch` prevents the
  stop click's default action. The fix is installed through pnpm's locked
  patch mechanism, without copying the composer into the application.
- All 499 dashboard and 1 shared unit tests and the per-file coverage gate passed;
  workspace browser checks (7) cover context switching, stop with a pending
  draft, retry, independent scrolling, and 320/390/1024px drawers. TypeScript,
  Biome, dependency boundaries, source scan, D1 isolation, and production build
  passed. Chat is loaded on demand as a separate approximately 212 kB JS
  chunk (65 kB gzip); the existing main bundle still exceeds Vite's 500 kB
  advisory threshold.
- Final browser validation passed all 42 cases across UI, dev, embedded, and
  first-run mint projects. Rich Markdown was checked at 320/390/1024/1440px
  in both themes. Dashboard statement/line coverage is 95.07%.
- Real browser chats passed for every installed agent through the production
  daemon factory: Claude, Codex, Hermes, and Pi. Each completed a rich Markdown
  response and a second turn recalling a random marker from the first turn.
  Code copying, nested lists, emphasis, quotes, task lists, left/center/right
  table cells, and mobile layout were verified against actual streamed output.
  No tool calls occurred. Copilot was skipped because its CLI is not on PATH.
- The final real-agent report is under
  `scripts/run-l2-output/real-chat/2026-09-08T00-06-26.159Z/` (ignored runtime
  artifacts). It contains summary JSON, the eight response streams, and
  desktop/mobile screenshots. The harness uses a fresh test bearer, isolated
  daemon data/workdir/Vite cache, and temporary loopback ports. Its file
  watcher is disabled so unrelated edits cannot restart an active test page.
- Trusted HTTPS HMR passed again on the canonical hostname: WSS connected,
  an actual CSS edit updated the page, and both the document and unsent draft
  survived. Main-origin and direct daemon health checks passed. Root
  `CLAUDE.md` now records the verified local startup contract.

## Repeat real-agent browser verification

```bash
MEOWTH_REAL_CHAT=1 pnpm dashboard:e2e:real
```

The command is opt-in and reuses installed CLI authentication. It creates and
cleans up its own test services; it leaves normal ports 7040/37040 available.
`MEOWTH_REAL_CHAT_AGENTS=codex,hermes` optionally narrows the inventory. Missing
CLIs are recorded as skipped; installed agents with failed responses or failed
render/continuation checks make the command exit nonzero. Reports are written
to a timestamped directory under `scripts/run-l2-output/real-chat/`. The harness
does not enable Playwright traces or videos containing browser authentication.
