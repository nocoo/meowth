# Basalt provenance

Dashboard chrome and common controls come from the published
`@nocoo/basalt` package. Do not source-copy Basalt primitives.

| Field         | Value |
|---------------|-------|
| package       | `@nocoo/basalt` |
| version       | `^3.5.1` |
| adopted_at    | 2026-09-09 |
| contract      | `docs/features/07-dashboard-basalt-package.md`, `docs/features/08-dashboard-theme-and-vite.md` |
| integration   | `~/workspace/personal/basalt/INTEGRATION.md` |

Brand accent is Meowth blue, applied through `AccentProvider`
`paletteOverrides.primary` in `components/basalt-providers.tsx`.

## Application-owned controls

- `components/Notice.tsx` — Meowth semantic status colors
- `components/EmptyState.tsx` — Meowth empty/error card composition
- `components/SecretReveal.tsx` — token one-shot reveal
- `components/chat/*` — agent transcript, composer, header and inbox behavior

All shared controls, icons and layout primitives import directly from
`@nocoo/basalt`; `components/ui/` is intentionally absent.
