// Phase 2 dashboard redesign Stage B2 — APP_VERSION single source.
//
// Re-exports the build-time constant injected by Vite's `define`
// (see `apps/dashboard/vite.config.ts`). The dashboard MUST NOT
// import `package.json` directly at runtime (TS / Vite would pull
// it into the bundle and bypass the build-time substitution); the
// ambient declaration in `vite-env.d.ts` makes `__APP_VERSION__`
// available as a global type.

export const APP_VERSION: string = __APP_VERSION__;
