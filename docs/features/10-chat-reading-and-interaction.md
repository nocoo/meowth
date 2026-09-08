# 10 · Chat reading and interaction

> Status: in progress (2026-09-08).
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
| Validation | Adjacent unit tests, `apps/dashboard/e2e/ui/`, `e2e/real/run-chat.ts` |
| Runtime contract | Root `CLAUDE.md`: canonical HTTPS origin and ports 7040/37040 |

## Atomic commit plan

1. `docs: plan chat reading and interaction` — design, quality plan, and indexes.
2. `feat: keep chat activity out of the way` — activity grouping, collapsed
   details, stable streaming identity, and focused behavioral tests.
3. `feat: give chat a focused reading layout` — template-based workspace,
   picker, welcome state, composer, response styling, and interaction coverage.
4. `test: verify refined chat with local agents` — browser and real-agent
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

Pending implementation and verification.
