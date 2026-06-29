import { cn } from '@/lib/utils';
import { Loader2, RotateCw } from 'lucide-react';
import { useRefresh } from './refresh-context';

// Header refresh button: visible only when the active Page has
// registered a refresh handler via `useRegisterRefresh`. Pages
// that don't fetch data (or where re-fetch is meaningless) never
// register, so the button stays hidden — keeping the header
// honest about what's actually refreshable.
//
// Visual class set mirrors ThemeToggle / the GitHub link so the
// header stays a uniform row of ghost-style 8x8 icon buttons.

export interface RefreshButtonProps {
  className?: string;
}

export default function RefreshButton({ className }: RefreshButtonProps) {
  const { handler, pending, trigger } = useRefresh();
  if (handler === null) return null;
  const label = pending ? 'Refreshing…' : 'Refresh page data';
  return (
    <button
      type="button"
      onClick={() => {
        void trigger();
      }}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-60',
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.5} />
      ) : (
        <RotateCw className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      )}
    </button>
  );
}
