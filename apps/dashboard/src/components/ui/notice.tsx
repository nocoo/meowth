import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

const noticeVariants = cva('rounded-basalt-widget border p-3 text-sm leading-relaxed', {
  variants: {
    variant: {
      info: 'border-basalt-info/20 bg-basalt-info-tint text-basalt-info',
      success:
        'border-basalt-heatmap-green-4/20 bg-basalt-heatmap-green-1/30 text-basalt-heatmap-green-4',
      warning: 'border-basalt-warning/20 bg-basalt-warning-tint text-basalt-warning',
      destructive: 'border-basalt-danger/20 bg-basalt-danger-tint text-basalt-danger',
    },
  },
  defaultVariants: { variant: 'info' },
});

export interface NoticeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof noticeVariants> {}

function Notice({ className, variant, ...props }: NoticeProps) {
  return (
    <div
      role="status"
      data-slot="notice"
      className={cn(noticeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Notice, noticeVariants };
