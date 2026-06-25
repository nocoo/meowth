/// <reference types="vite/client" />

// Phase 2 dashboard redesign Stage B2 — APP_VERSION injection.
// Declared as an ambient module so `lib/version.ts` can read
// `__APP_VERSION__` without importing any package.json into the
// runtime bundle. The value is substituted by Vite's `define`
// at build time (see `apps/dashboard/vite.config.ts`).
declare const __APP_VERSION__: string;
