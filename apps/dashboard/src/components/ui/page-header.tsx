import { cn } from '@/lib/utils';
import { PageHeader as BasaltPageHeader } from '@nocoo/basalt/components/page-header';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: React.ReactNode;
  headingId?: string;
  className?: string;
}

export function PageHeader({ title, description, actions, headingId, className }: PageHeaderProps) {
  return (
    <div className={cn(className)}>
      <BasaltPageHeader
        title={<span id={headingId}>{title}</span>}
        description={description}
        actions={actions}
      />
    </div>
  );
}
