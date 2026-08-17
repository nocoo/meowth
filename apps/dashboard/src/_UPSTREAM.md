# Basalt source-copy

Files in `apps/dashboard/src/` listed below are source-copied (not
npm-imported) from the basalt design system. Track upstream so the
copy can be refreshed; refresh flow is documented in
`docs/architecture/06-dashboard-mvvm-and-basalt.md` §4.2.

| Field         | Value |
|---------------|-------|
| source_repo   | local: ~/workspace/personal/basalt |
| source_commit | bbd99c122ccfc7a3572a16bf8fe5cab37c1822d1 |
| copied_at     | 2026-06-22 |
| copy_method   | manual cp (per-file; not directory vendor) |
| license       | MIT (see ~/workspace/personal/basalt/LICENSE) |

## File map

See `docs/architecture/06-dashboard-mvvm-and-basalt.md` §4.1.1
(source-copy verbatim) and §4.1.2 (meowth-local adapted; not in
this commit yet) and §4.1.3 (meowth-local additions; not in this
commit yet).

### Source-copy verbatim — landed in Phase 3.13

| basalt upstream path           | meowth target                                  |
|--------------------------------|-----------------------------------------------|
| src/index.css                  | apps/dashboard/src/index.css                  |
| src/lib/utils.ts               | apps/dashboard/src/lib/utils.ts               |
| src/lib/palette.ts             | apps/dashboard/src/lib/palette.ts             |

`button.tsx` / `input.tsx` / `dialog.tsx` were copied from basalt
in Phase 3.13 and **superseded** by the zhe/pew copies in
`docs/features/04`. `card.tsx` was deleted in Stage B4 and
**restored** from zhe in that same feature.

### Source-copy verbatim — superseded by surety provenance below

Gen 2 ui primitives (`badge.tsx`, `label.tsx`, `separator.tsx`,
`tooltip.tsx`, `dropdown-menu.tsx`, etc.) are **no longer copied
from basalt**. They are copied from surety in Stage A3/A4 of the
dashboard redesign (see `docs/features/02-dashboard-redesign-to-basalt-gen2.md`).
The "surety provenance" section below tracks those copies.

### Meowth-local adapted — Phase 3.13 / Phase 2 redesign

These components are written locally in Meowth, inspired by other
projects' layout patterns but not source-copied. Phase 3.13 listed
the Gen 1 trio (AppSidebar, DashboardLayout, ThemeToggle); the
Phase 2 dashboard redesign Stage B1 replaces the first two with a
Gen 2 layout cluster under `components/layout/`. ThemeToggle stays
in place.

- `components/layout/sidebar.tsx` — Gen 2 sidebar with collapsed/
  expanded states + Tooltip rail + mobile drawer adapter. Inspired
  by `surety/apps/web/src/components/layout/sidebar.tsx`
  @cbf7045f, but drops surety-specific dependencies (useMe,
  getDisplayName, getAvatarColor, CommandPalette, DbSelector,
  GitHub icon) that have no equivalent in meowth.
- `components/layout/app-shell.tsx` — Gen 2 AppShell with floating
  island main panel. Inspired by
  `surety/apps/web/src/components/layout/app-shell.tsx` @cbf7045f
  with the same surety-specific dependencies removed.
- `components/layout/breadcrumbs.tsx` — adapted from surety's
  `breadcrumbs.tsx` @cbf7045f; English aria label (no 面包屑) and
  no brand/URL coupling — the caller passes labels via props.
- `lib/navigation.ts` — pure-data nav table for meowth's 5 product
  pages; replaces the inline `ITEMS` array that lived in the
  deleted `components/AppSidebar.tsx`.
- `components/ThemeToggle.tsx` (Phase 3.14; no i18n; direct
  localStorage + classList).

### Meowth-local source-derived (formatted / coverage-annotated) — Phase 2 redesign Stage B1

The following files start from a surety @cbf7045f source verbatim
but are NOT byte-clean after meowth's biome formatter runs (single
vs double quotes, import order). One also carries a coverage
annotation that did not exist upstream. They keep surety's semantics
1:1 — only formatting and coverage comments diverge.

- `components/layout/sidebar-context.tsx` — derived from
  `surety/apps/web/src/components/layout/sidebar-context.tsx`
  @cbf7045f. Biome reformatted the import line (single quotes,
  reordered named imports) and the throw message string.
- `hooks/use-mobile.ts` — derived from
  `surety/apps/web/src/hooks/use-mobile.ts` @cbf7045f. Biome
  reformatted single/double quotes; meowth adds a
  `/* v8 ignore start/stop */` block around `getServerSnapshot`
  with a comment explaining why (Vite SPA never hits SSR, so the
  branch is unreachable at L1 coverage). No runtime behavior
  change.

### Meowth-local additions — deferred

- `components/Spinner.tsx` (Phase 3.14; lucide-react `Loader2` + animate-spin)
- `components/SecretReveal.tsx` (Phase 3.19; see 07 §7)

## Local modifications permitted on source-copied files

Per 06 §4.3, after copy we may:

- Rename menu items / route paths to match meowth pages.
- Delete props or component variants meowth does not use.

We may NOT:

- Introduce nested card-in-card / modal-in-modal layouts that
  break basalt's visual density.
- Add a parallel design-token system; only append meowth-specific
  tokens at the END of `index.css`, never override basalt tokens.
- Use UI libraries that conflict with basalt's style (Radix /
  shadcn are aligned with basalt already, so they are fine when
  basalt itself uses them — `dialog.tsx` for instance).

---

# surety provenance

Gen 2 ui primitives source-copied from surety in the dashboard
redesign (Phase 2 feature plan
`docs/features/02-dashboard-redesign-to-basalt-gen2.md` §5.5).

| Field         | Value |
|---------------|-------|
| source_repo   | local: ~/workspace/personal/surety |
| source_commit | cbf7045facc32f03bfb562d6491f6ee3003e538c |
| copied_at     | 2026-06-25 |
| copy_method   | manual cp (per-file; not directory vendor) |
| license       | MIT (Copyright 2026 Zheng Li; see ~/workspace/personal/surety/LICENSE) |
| allowed_modifications | `cn` import alias only (`@/lib/utils`, already aligned); preserve `from "radix-ui"` namespace imports verbatim; no business logic or layout changes |

## File map

### Stage A3 — Gen 2 layout primitives (G1, 8 files; landed)

| surety upstream path                                 | meowth target                                          |
|------------------------------------------------------|--------------------------------------------------------|
| apps/web/src/components/ui/tooltip.tsx               | apps/dashboard/src/components/ui/tooltip.tsx           |
| apps/web/src/components/ui/sheet.tsx                 | apps/dashboard/src/components/ui/sheet.tsx             |
| apps/web/src/components/ui/avatar.tsx                | apps/dashboard/src/components/ui/avatar.tsx            |
| apps/web/src/components/ui/collapsible.tsx           | apps/dashboard/src/components/ui/collapsible.tsx       |
| apps/web/src/components/ui/separator.tsx             | apps/dashboard/src/components/ui/separator.tsx         |
| apps/web/src/components/ui/badge.tsx                 | apps/dashboard/src/components/ui/badge.tsx             |
| apps/web/src/components/ui/skeleton.tsx              | apps/dashboard/src/components/ui/skeleton.tsx          |
| apps/web/src/components/ui/empty-state.tsx           | apps/dashboard/src/components/ui/empty-state.tsx       |

### Stage A4 — page-migration primitives (G2, 11 files; landed)

| surety upstream path                                 | meowth target                                          |
|------------------------------------------------------|--------------------------------------------------------|
| apps/web/src/components/ui/table.tsx                 | apps/dashboard/src/components/ui/table.tsx             |
| apps/web/src/components/ui/dropdown-menu.tsx         | apps/dashboard/src/components/ui/dropdown-menu.tsx     |
| apps/web/src/components/ui/select.tsx                | apps/dashboard/src/components/ui/select.tsx            |
| apps/web/src/components/ui/label.tsx                 | apps/dashboard/src/components/ui/label.tsx             |
| apps/web/src/components/ui/notice.tsx                | apps/dashboard/src/components/ui/notice.tsx            |
| apps/web/src/components/ui/section-divider.tsx       | apps/dashboard/src/components/ui/section-divider.tsx   |
| apps/web/src/components/ui/switch.tsx                | apps/dashboard/src/components/ui/switch.tsx            |
| apps/web/src/components/ui/textarea.tsx              | apps/dashboard/src/components/ui/textarea.tsx          |
| apps/web/src/components/ui/toggle.tsx                | apps/dashboard/src/components/ui/toggle.tsx            |
| apps/web/src/components/ui/toggle-group.tsx          | apps/dashboard/src/components/ui/toggle-group.tsx      |
| apps/web/src/components/ui/sort-header.tsx           | apps/dashboard/src/components/ui/sort-header.tsx       |

### G3 — destructive-confirm primitives (1 file; on-demand)

| surety upstream path                                 | meowth target                                          |
|------------------------------------------------------|--------------------------------------------------------|
| _alert-dialog.tsx, not used; revoke uses pew confirm-dialog instead_      | _-_                                                    |

---

# zhe / pew provenance

Control-density and dialog recipe copies from the 2026-08-17
alignment (`docs/features/04-dashboard-control-alignment.md`).

| Field         | Value |
|---------------|-------|
| zhe           | local: ~/workspace/personal/zhe (`nocoo/zhe`) @90a1320b777d646c81e96e72bc124595ad88a9c4 |
| pew           | local: ~/workspace/personal/pew @fd86e50a561868154659841065b2b66b06fe5161 |
| copied_at     | 2026-08-17 |
| license       | MIT |

| upstream path | meowth target | notes |
|---------------|---------------|-------|
| zhe `components/ui/button.tsx` + `docs/22-design-tokens.md` | `components/ui/button.tsx` | density ladder; `Slot.Root` from `radix-ui` |
| zhe `components/ui/input.tsx` | `components/ui/input.tsx` | default/sm; omit native `size` |
| zhe `components/ui/card.tsx` | `components/ui/card.tsx` | L2 `bg-secondary rounded-card` |
| zhe `components/ui/page-header.tsx` | `components/ui/page-header.tsx` | plus `headingId` for `aria-labelledby` |
| pew Dialog recipe + `confirm-dialog.tsx` | `components/ui/dialog.tsx`, `confirm-dialog.tsx` | overlay `/60`, `bg-card rounded-xl` |
