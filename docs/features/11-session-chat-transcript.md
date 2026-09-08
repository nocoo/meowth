# 11 · Shared Chat rendering for session details

## Design

Session detail routes currently render individual envelopes as plain text rows.
Restore the same conversation presentation used by Chat, including streamed
text coalescing, safe Markdown, code copying, and closed thinking/tool details.

- Extract the existing assistant response, event grouping, and activity
  controls into `apps/dashboard/src/components/chat/`. Chat keeps its composer,
  conversation state, user prompts, and retry behavior; both pages consume the
  shared response renderer and 760 px reading-column styles.
- Preserve session metadata and the existing paginated snapshot loader.
  Recorded sessions contain agent events, without the original user prompt;
  show the recorded response without inventing user bubbles or sending actions.
- Session details are the destination for Chat's truncated-output links. Render
  all collected events and complete text/tool payloads there, with no link back
  to the same detail page. Keep long tool output in scrollable disclosures.
- Preserve error details, final status, usage, keyboard disclosure access,
  literal tool output, safe Markdown links, and light/dark responsive behavior.
- Inspect the requested Pi session
  `01a07e92-2284-735b-a9b0-cbbd98098bd4` through read-only local data access.

## Code references

| Responsibility | Files |
| --- | --- |
| Shared responses | `apps/dashboard/src/components/chat/AgentResponse.tsx`, `MessageBubble.tsx`, `MessageActivity.tsx`, `ActivityDisclosure.tsx`, `messageGroups.ts`, `chat-transcript.css` |
| Chat turn wrapper | `apps/dashboard/src/pages/Chat/MessageList.tsx` |
| Session presentation | `apps/dashboard/src/pages/Sessions/SessionDetailContent.tsx`, `SessionDetailSkeleton.tsx` |
| Snapshot loading | `apps/dashboard/src/viewmodels/useSessionDetailViewModel.ts` |
| Existing rich text | `apps/dashboard/src/components/MessageMarkdown.tsx`, `MessageText.tsx`, `CopyButton.tsx` |
| Verification | Adjacent component tests and `apps/dashboard/e2e/ui/` |

## Atomic commit plan

1. `docs: plan shared session chat rendering` — scope, shared ownership, and
   verification requirements.
2. `feat: reuse chat rendering in session details` — extract the shared
   response controls, restore the session transcript, preserve full output,
   and verify both consumers with focused regression checks.

## 6DQ quality plan

| Dimension | Verification |
| --- | --- |
| L1 | Existing Chat grouping, disclosure, streaming, retry, and truncation checks; session Markdown, full output, tool expansion, errors, and empty state. |
| L2 | Keep the snapshot API unchanged; verify pagination retains every recorded event. No new agent executions are needed for a rendering change. |
| L3 | Session deep links in light/dark and desktop/mobile; merged Markdown, code clipboard, closed tool results, complete long output, and 760 px layout. Replay the requested session's recorded events. |
| G1 | Biome, TypeScript, import boundaries, source checks, and dashboard/embedded builds. |
| G2 | Reuse safe Markdown and literal tool output; preserve CSP and avoid remote image fetching. |
| D1 | Read normal session data without changing it. Keep browser fixtures and artifacts isolated; reuse Vite on the canonical development URL. |
