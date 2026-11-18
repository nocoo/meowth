import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ChatInboxItem {
  id: string;
  title: string;
  preview: string;
}

interface ChatInboxProps extends Omit<HTMLAttributes<HTMLElement>, 'onSelect'> {
  items: readonly ChatInboxItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ChatInbox({ items, activeId, onSelect, className, ...props }: ChatInboxProps) {
  return (
    <nav className={cn('min-h-0 overflow-y-auto', className)} aria-label="Conversations" {...props}>
      <div className="flex flex-col gap-basalt-nav-gap">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === activeId ? 'page' : undefined}
            className={cn(
              'w-full rounded-basalt-widget px-3 py-2.5 text-left transition-colors hover:bg-basalt-accent/60',
              item.id === activeId && 'bg-basalt-accent',
            )}
            onClick={() => onSelect(item.id)}
          >
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="mt-1 block truncate text-xs text-basalt-muted-foreground">
              {item.preview}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
