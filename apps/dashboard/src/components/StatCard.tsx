import { LayerCard } from '@nocoo/basalt';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface StatCardProps {
  title: string;
  body: ReactNode;
  icon?: LucideIcon;
  description?: string;
}

export default function StatCard({ title, body, icon: Icon, description }: StatCardProps) {
  return (
    <LayerCard
      outlined
      className="flex min-h-36 min-w-0 flex-col justify-between gap-4 p-4 sm:min-h-40 sm:p-6"
      padding="lg"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-basalt-muted-foreground sm:text-sm">{title}</h3>
        {Icon ? (
          <span className="flex h-7 w-7 shrink-0 sm:h-8 sm:w-8 items-center justify-center rounded-basalt-widget bg-basalt-accent text-basalt-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
          </span>
        ) : null}
      </div>
      <div>
        <div className="flex min-h-9 items-center text-3xl font-semibold tracking-tight tabular-nums">
          {body}
        </div>
        {description ? (
          <p className="mt-2 text-xs leading-5 text-basalt-muted-foreground">{description}</p>
        ) : null}
      </div>
    </LayerCard>
  );
}
