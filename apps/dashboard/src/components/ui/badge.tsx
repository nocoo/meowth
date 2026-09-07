import { cn } from '@/lib/utils';
import { Badge as BasaltBadge } from '@nocoo/basalt';
import type { ComponentProps } from 'react';

export function Badge({ variant, className, ...props }: ComponentProps<typeof BasaltBadge>) {
  return (
    <BasaltBadge
      variant={variant}
      className={cn(
        variant === 'success' &&
          'bg-basalt-heatmap-green-1/30 text-basalt-heatmap-green-4',
        className,
      )}
      {...props}
    />
  );
}
