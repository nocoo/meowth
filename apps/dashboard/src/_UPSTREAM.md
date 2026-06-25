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
| src/components/ui/button.tsx   | apps/dashboard/src/components/ui/button.tsx   |
| src/components/ui/card.tsx     | apps/dashboard/src/components/ui/card.tsx     |
| src/components/ui/input.tsx    | apps/dashboard/src/components/ui/input.tsx    |
| src/components/ui/dialog.tsx   | apps/dashboard/src/components/ui/dialog.tsx   |

### Source-copy verbatim — superseded by surety provenance below

Gen 2 ui primitives (`badge.tsx`, `label.tsx`, `separator.tsx`,
`tooltip.tsx`, `dropdown-menu.tsx`, etc.) are **no longer copied
from basalt**. They are copied from surety in Stage A3/A4 of the
dashboard redesign (see `docs/features/02-dashboard-redesign-to-basalt-gen2.md`).
The "surety provenance" section below tracks those copies.

### Meowth-local adapted — deferred to Phase 3.14

These components are written locally in Meowth, inspired by
basalt's layout pattern but not source-copied. See 06 §4.1.2.

- `components/AppSidebar.tsx` (no i18n, no command palette; 5 pages + Setup)
- `components/DashboardLayout.tsx` (no i18n, no LanguageToggle, no GitHub icon)
- `components/ThemeToggle.tsx` (no i18n; direct localStorage + classList)

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
| _alert-dialog.tsx, copied only when a page commit actually consumes destructive confirm_      | _-_                                                    |
