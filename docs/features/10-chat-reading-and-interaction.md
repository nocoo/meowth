# 10 · Chat reading and interaction

> Status: implemented and verified (2026-09-08).
> References: Basalt's Chat template, `INTEGRATION.md`, and the installed
> `@nocoo/basalt@2.1.0` component contracts.

## Design

The Chat workspace should prioritize writing and reading, with execution
details available on demand. This refines feature 09 without changing its
conversation, cancellation, retry, or continuation contracts.

- Group consecutive thinking, tool, and diagnostic events into compact
  activity disclosures. Keep them closed initially, including while streaming.
  Preserve the reader's expanded state as new events arrive. Coalesce thinking
  deltas, preserve event order, and keep errors outside collapsed content.
- Match tool input and output only when their `call_id` agrees. Unmatched
  events remain inspectable. Use bounded, literal output and Sessions links
  for large payloads; never interpret tool output as HTML.
- Place a quiet, prominent agent picker at the upper left of the conversation.
  Use Basalt's accessible selection primitives with distinct names, descriptions,
  and a selected indicator. The API advertises installed agents, not a model
  catalog; selection continues to use each agent's configured model.
- Keep the Basalt application shell. Refine the conversation list and allow
  it to collapse on desktop; use the existing accessible drawer on narrow
  screens. Give the conversation a generous, bounded reading column.
- Use neutral user bubbles, open assistant typography, restrained response
  actions, and a spacious Basalt composer. Center the composer with the welcome
  state before the first message, then anchor it below the conversation.
  Keep all displayed actions functional and all visible labels in sentence case.
- Preserve Markdown, code copying, safe links, table alignment, independent
  reader scrolling, unsent drafts during stop, and background conversations.

## Code references

| Area | Files |
|---|---|
| Workspace and picker | `apps/dashboard/src/pages/Chat/ChatContent.tsx`, `ChatSidebar.tsx`, `AgentPicker.tsx` |
| Responses and activity | `apps/dashboard/src/pages/Chat/MessageList.tsx`, `MessageBubble.tsx`, `messageGroups.ts`, new activity components |
| Rich content | `apps/dashboard/src/components/MessageMarkdown.tsx`, `message-markdown.css`, `CopyButton.tsx` |
| State and transport | `apps/dashboard/src/viewmodels/useChatViewModel.ts`, `models/chat.ts` |
| Hermes tool notifications | `daemon/pkg/agent/hermes.go`, `daemon/pkg/agent/hermes_test.go` |
| Validation | Adjacent unit tests, `apps/dashboard/e2e/ui/`, `e2e/real/run-chat.ts` |
| Runtime contract | Root `CLAUDE.md`: canonical HTTPS origin and ports 7040/37040 |

## Atomic commit plan

1. `docs: plan chat reading and interaction` — design, quality plan, and indexes.
2. `feat: keep chat activity out of the way` — activity grouping, collapsed
   details, stable streaming identity, and focused behavioral tests.
3. `feat: give chat a focused reading layout` — template-based workspace,
   picker, welcome state, composer, response styling, and interaction coverage.
4. `fix: retain hermes calls without raw input` — real validation found that
   current Hermes omits `rawInput` on its complete tool-start notifications.
   Emit those calls immediately with the available content/locations; keep
   explicit `in_progress` argument streams buffered. Show an honest missing
   result state when a backend ends the turn without a tool result.
5. `fix: keep tool labels in sentence case` — use the existing display-label
   formatter for backend tool identifiers, preserving raw event payloads.
6. `test: verify refined chat with local agents` — browser and real-agent
   verification, any necessary harness updates, and recorded results. Fix
   independently discovered defects in separate atomic commits.

## 6DQ quality plan

| Dimension | Validation |
|---|---|
| L1 | Disclosure defaults and keyboard behavior; stable open state during streamed updates; exact tool matching; thinking coalescing; preserved visible errors; existing conversation/stop/retry tests and per-file coverage. |
| L2 | Exercise installed Claude, Codex, Hermes, and Pi through the isolated production-factory harness. Keep Copilot explicitly skipped if unavailable. Verify rich responses and actual continuation. |
| L3 | Inspect light/dark screenshots at desktop, tablet, and 320/390px mobile widths. Verify picker focus, drawer/collapse, code clipboard, long output, scrolling, composer position, and HTTPS HMR. |
| G1 | Biome, TypeScript, dependency boundaries, source scan, production build, and affected dev/embedded browser checks. |
| G2 | Maintain safe Markdown and literal tool output, no new remote image fetches or HTML evaluation, and the existing CSP. |
| D1 | Reuse normal services. Keep test services, data, prompts, and artifacts isolated; do not print tokens or modify normal CLI configuration. |

## Results

The workspace now uses Basalt's Chat shell, header, composer, selection, and
collapsible primitives with a 760px reading column. Thinking and consecutive
tool events share a closed activity summary. Each tool's input and result can
be opened independently; expanded state survives incoming deltas. Backend
tool identifiers use the shared sentence-case display formatter while the
recorded payloads remain unchanged.

The agent menu stays at the upper left and shows provider descriptions and
the current selection. The welcome composer is centered; active conversations
keep it below the scroll area. Desktop conversations can collapse, and compact
layouts use the accessible drawer. Neutral bubbles, open assistant typography,
consistent Markdown, and restrained copy/session controls complete the layout.

| Check | Result |
|---|---|
| Unit tests | 509 dashboard + 1 shared passed; statement/line coverage 95.29%; per-file coverage gate passed. |
| Protocol regression | `go test -race ./pkg/agent -run 'Hermes\|ACP'` passed, including immediate tool starts without raw input and buffered argument streams. |
| Browser checks | 37 UI + 17 dev/embedded/mint checks passed. The 12 refined Chat cases were rerun after the missing-result fix. |
| Visual and interaction review | Light/dark at 1440, 1024, 390, and 320px; keyboard picker focus, drawers, desktop collapse, streaming expansion, copying, long output, and independent scrolling checked. |
| Build and static checks | Dashboard and daemon G1, dependency boundaries, source scan, production/embedded build, and D1 passed. No dependencies added. The existing main-bundle size advisory remains. |
| Canonical HTTPS | Trusted TLS, healthy daemon, one same-origin WSS connection, CSS HMR, and preserved document/unsent draft verified at `https://meowth.dev.hexly.ai`. |

The real-agent harness now adds a third turn that runs one read-only command
against an isolated fixture. Its unpredictable marker exists only in the file,
so the check verifies actual tool output. Assertions cover closed defaults,
expanded input/results, literal HTML-like output, bold final responses, and
visible desktop/mobile detail. Screenshots finish animations before capture.
The fixture Vite watcher is closed explicitly to prevent unrelated repository
artifact writes from interrupting real conversations; normal Vite HMR remains
enabled.

| Installed agent | Rich Markdown, code copy, and alignment | Continuation | Real tool call/result |
|---|---|---|---|
| Claude | Passed | Passed | 1 / 1; collapsed and expanded |
| Codex | Passed | Passed | 1 / 1; collapsed and expanded |
| Hermes | Passed | Passed | 1 / 1; terminal path |
| Pi | Passed | Passed | 1 / 1; collapsed and expanded |
| Copilot | Skipped: CLI not installed | — | — |

Run with `MEOWTH_REAL_CHAT=1 pnpm dashboard:e2e:real`. Local ignored artifacts
are under `scripts/run-l2-output/real-chat/2026-09-08T00-53-55.596Z/`:
`summary.json`, per-turn event streams, and desktop/mobile screenshots.
An additional Hermes run is under `2026-09-08T00-56-28.756Z/` in the same parent.
The capture path now waits for disclosure animations before scrolling and
requires the full result block to be in view. Replaying the recorded Codex
events verified that the result stays fully visible after desktop/mobile
captures; those review images are in `/tmp/meowth-tool-final-review/`.

The final embedded build is running with the normal local configuration on
7040, with the existing Vite service on 37040. Both loopback and canonical
HTTPS health checks passed. Startup commands and the single browser URL are
documented in root `CLAUDE.md`.

### Real-agent investigation

The installed Hermes ACP runtime sends a `tool_call` for `read_file` with
`locations` and no `rawInput` or `status`. The old adapter deferred it until a
completion event, so a missing completion hid the entire invocation. A direct
isolated ACP probe confirmed that the runtime omits `tool_call_update` for this
read. Its completion formatter receives stringified arguments where it expects
a dictionary. Keep invocation rendering correct in Meowth without modifying
the user's global Hermes installation or inventing output. Meowth now renders
the available invocation immediately, retains call IDs, and shows
`No tool result was reported by this agent.` when a turn ends without its
result. Results separated from their invocation by prose remain inspectable
in their original position.

A direct ACP probe and a real browser conversation confirmed that Hermes'
terminal tool does emit its completion and result. The final harness explicitly
requests that tool to verify actual output rendering. This validates the
supported path without claiming that the installed runtime's `read_file`
completion bug is fixed.
