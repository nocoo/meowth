import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: React.ReactNode;
  headingId?: string;
  className?: string;
}

export function PageHeader({ title, description, actions, headingId, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2
          id={headingId}
          className="truncate text-2xl font-semibold tracking-tight text-foreground md:text-[1.75rem]"
        >
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
