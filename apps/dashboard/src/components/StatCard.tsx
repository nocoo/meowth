import { LayerCard } from '@nocoo/basalt';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface StatCardProps {
  title: string;
  body: ReactNode;
  icon?: LucideIcon;
}

export default function StatCard({ title, body, icon: Icon }: StatCardProps) {
  return (
    <LayerCard outlined>
      <div className="bg-basalt-primary mb-3 h-1 w-10 rounded-full" />
      <div className="text-basalt-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wide">
        {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
        <h3>{title}</h3>
      </div>
      <div className="mt-2 text-2xl font-semibold">{body}</div>
    </LayerCard>
  );
}
