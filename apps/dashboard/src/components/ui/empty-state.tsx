import { cn } from '@/lib/utils';
import { LayerCard } from '@nocoo/basalt';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'default',
  className,
}: EmptyStateProps) {
  return (
    <LayerCard outlined {...(className ? { className } : {})}>
      <LayerCard.Empty
        title={title}
        {...(description ? { description } : {})}
        {...(action ? { action } : {})}
        icon={
          <Icon
            className={cn('h-10 w-10', tone === 'error' ? 'text-destructive-text' : 'text-primary')}
            strokeWidth={1.5}
          />
        }
      />
    </LayerCard>
  );
}
