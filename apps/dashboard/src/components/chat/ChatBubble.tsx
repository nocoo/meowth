import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ChatBubbleProps extends HTMLAttributes<HTMLDivElement> {
  variant: 'user' | 'assistant';
  streaming?: boolean;
}

export function ChatBubble({
  variant,
  streaming = false,
  className,
  children,
  ...props
}: ChatBubbleProps) {
  return (
    <div
      data-variant={variant}
      data-basalt-surface
      aria-busy={streaming || undefined}
      className={cn(
        'min-w-0 rounded-basalt-lg p-basalt-card ring-1 ring-basalt-border/80 shadow-basalt-card',
        variant === 'user' ? 'ml-auto bg-basalt-secondary' : 'mr-auto bg-basalt-card',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
