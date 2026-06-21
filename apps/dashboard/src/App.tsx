// Phase 3.13 placeholder. App shell + AppSidebar + DashboardLayout
// + ThemeToggle land in Phase 3.14; pages and routing in 3.17.
// This stub renders a single screen so the basalt token system
// (background / foreground / card) is visibly applied end-to-end
// when running `pnpm --filter @meowth/dashboard dev`.
export default function App() {
  return (
    <div className="bg-background text-foreground min-h-screen p-8">
      <h1 className="text-2xl font-semibold">Meowth dashboard</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Vite + Tailwind v4 + basalt token system wired (Phase 3.13). App shell lands in Phase 3.14.
      </p>
    </div>
  );
}
