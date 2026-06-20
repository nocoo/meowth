# Meowth

Monorepo: pnpm + Turborepo + TypeScript + Biome.

## Structure

```
apps/
  web/          # frontend app (TBD framework)
  api/          # backend service (TBD framework)
packages/
  shared/       # shared types & utils
```

## Commands

```bash
pnpm install            # install all workspace deps
pnpm dev                # run all dev tasks
pnpm build              # build all packages
pnpm typecheck          # typecheck all packages
pnpm lint               # biome lint
pnpm format             # biome format
```

## Requirements

- Node >= 20
- pnpm >= 11
