import { SkeletonLine } from '@nocoo/basalt/components/skeleton-line';

// docs/architecture/06 §7.5 + features/02 §4.4 — Phase 2 Stage C5.
// Pre-data placeholder for the Daemon (healthz) row + Notice slot
// only. The Dashboard build row is owned by the Page so the real
// compile-time `vm.version` stays visible during loading (it is
// orthogonal to healthz; never a fake placeholder per reviewer
// correction).

export default function SettingsSkeleton() {
  return (
    <>
      <SkeletonLine className="h-4 w-44" />
      <SkeletonLine className="h-12 w-full" />
    </>
  );
}
