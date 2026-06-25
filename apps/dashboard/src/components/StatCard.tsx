import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// docs/architecture/06 §7.1 + features/02 §5.1 — Phase 2 Stage C1
// StatCard. Replaces OverviewPage's inline `StatPanel` so the four
// stat tiles share one implementation and future pages (Agents
// summary, Settings counters) can reuse the shape.
//
// Scope per reviewer: title + body + optional icon only. No chart
// variants, no trend arrows, no value-format helpers. Add those
// later when an actual consumer needs them.

export interface StatCardProps {
  title: string;
  body: ReactNode;
  icon?: LucideIcon;
}

export default function StatCard({ title, body, icon: Icon }: StatCardProps) {
  return (
    <div className="bg-secondary rounded-card p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wide">
        {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
        <h3>{title}</h3>
      </div>
      <div className="mt-2 text-2xl font-semibold">{body}</div>
    </div>
  );
}
