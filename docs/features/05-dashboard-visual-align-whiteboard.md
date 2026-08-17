# 05 · Dashboard visual alignment to Whiteboard pew chrome

> Status: landed.
> History: `git log -- docs/features/05-dashboard-visual-align-whiteboard.md`
> Companion: [`02`](./02-dashboard-redesign-to-basalt-gen2.md) (shell), [`03`](./03-dashboard-chat-with-online-agent.md) (chat contract), [`04`](./04-dashboard-control-alignment.md) (control density).
> Reference: `~/workspace/work/whiteboard/intentional-kusto-queries/data/dashboard` (AppShell, SectionNav, chat panel). This revision **does not** change that repo.

---

## 1. Intent

Meowth dashboard chrome is flatter than the pew-style Whiteboard analytics UI: 150ms width-only sidebar, centered collapsed mark, gray active nav, island with no ring, page chat as stacked cards.

Align **Meowth** to that chrome. Keep Meowth routes, MVVM, tokens as the source of color identity, and Chat as a full page (no FAB).

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | Sidebar: `transition-all duration-300`; collapsed logo `h-14 pl-6 pr-3 justify-start`; active item `bg-primary/10 text-primary`. |
| D2 | Island keeps `.rounded-island.bg-card` (02/04 test lock) and adds `shadow-sm ring-1 ring-border/40`. |
| D3 | L2 cards keep `bg-secondary rounded-card` and add `ring-1 ring-border/40`. No extra drop-shadow on cards. |
| D4 | Tables: hairline header + `hover:bg-primary/[0.04]`; optional inner ring on the scrollport. |
| D5 | Chat page: user bubble primary filled / assistant secondary + ring; composer is a rounded-2xl bar. Accessible names stay `Send` / `Cancel` / `Message`. |
| D6 | Accent tokens pick up a blue wash (`206 70% 94%` light / `206 36% 18%` dark) so `primary/10` and hover match Whiteboard. `--primary` stays Meowth `217 91% 60%`. |

## 3. Code

| Area | Path |
|---|---|
| Sidebar | `apps/dashboard/src/components/layout/sidebar.tsx` + `sidebar.test.tsx` |
| Island | `apps/dashboard/src/components/layout/app-shell.tsx` |
| Tokens | `apps/dashboard/src/index.css` |
| Cards | `apps/dashboard/src/components/ui/card.tsx`, `StatCard.tsx` |
| Table | `apps/dashboard/src/components/ui/table.tsx` |
| Chat | `apps/dashboard/src/pages/Chat/{ChatContent,ChatComposer,MessageList,MessageBubble}.tsx` |
| Page title | `apps/dashboard/src/components/ui/page-header.tsx` |

## 4. Atomic commits

1. `docs: plan whiteboard chrome alignment`
2. `fix: match sidebar collapse to pew rail`
3. `fix: ring the island and raise titles`
4. `fix: ring l2 cards and table hover`
5. `fix: restyle chat bubbles like pew`

## 5. 6DQ

| Dim | Plan |
|---|---|
| Function | Existing dashboard unit tests; Chat composer names unchanged. |
| Security | No new markup sinks; MessageText still sanitizes. |
| Reliability | Sidebar collapse + Chat Enter/Cancel tests. |
| Maintainability | 04 L2 “no border/shadow” is superseded here by ring-only. |
| Performance | Width transition 300ms; no layout thrash beyond existing remount. |
| Accessibility | Active nav still a link; Send/Cancel names preserved. |

## 6. Skip

- FAB / floating panel (Meowth Chat is a route).
- Microsoft `#0078D4` primary swap.
- Collapsible nav groups (Meowth has two static groups).
