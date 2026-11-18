import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ChatHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  leading?: ReactNode;
}

export function ChatHeader({ title, leading, className, children, ...props }: ChatHeaderProps) {
  return (
    <header className={cn('flex min-w-0 items-center', className)} {...props}>
      {leading}
      <div className="min-w-0 flex-1">{title}</div>
      <div className="flex shrink-0 items-center gap-basalt-space-xs">{children}</div>
    </header>
  );
}
