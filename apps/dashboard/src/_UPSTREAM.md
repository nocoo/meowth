# Basalt provenance

Dashboard chrome and common controls come from the published
`@nocoo/basalt` package. Do not source-copy primitives from the
basalt / surety / zhe / pew trees.

| Field         | Value |
|---------------|-------|
| package       | `@nocoo/basalt` |
| version       | `2.1.0` |
| adopted_at    | 2026-09-07 |
| contract      | `docs/features/07-dashboard-basalt-package.md` |
| integration   | `~/workspace/personal/basalt/INTEGRATION.md` |

Brand accent is Meowth blue, applied through `AccentProvider`
`paletteOverrides.primary` in `components/basalt-providers.tsx`.

## Local adapters (not upstream copies)

These stay in the dashboard because Basalt has no 1:1 export, or
because Meowth owns the behaviour:

- `components/ui/notice.tsx` — inline status block
- `components/ui/table.tsx` — simple table (Basalt ships DataTable)
- `components/ui/textarea.tsx` — chat composer
- `components/ui/skeleton.tsx` — pulse placeholder
- `components/ui/empty-state.tsx` — LayerCard.Empty adapter
- `components/ui/button.tsx` — size map (`xs` / `icon-sm`)
- `components/ui/page-header.tsx` — headingId adapter
- `components/ThemeToggle.tsx` — `meowth_theme` two-state storage
- `components/SecretReveal.tsx` — token one-shot reveal (architecture/07)
- Chat bubbles / composer / AgentPicker

Historical source-copy tables (basalt / surety / zhe / pew) lived
in this file before features/07. They are obsolete.
