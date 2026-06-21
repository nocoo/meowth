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

### Source-copy verbatim — deferred (按 06 §4.1.1 末段 "按 page 需要逐个增量 copy")

Additional ui primitives such as `badge.tsx`, `label.tsx`,
`separator.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, etc. are
copied incrementally in the commit that introduces the first
consuming page. Each copy commit must update this file with the
new row and the basalt commit SHA at copy time.

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
