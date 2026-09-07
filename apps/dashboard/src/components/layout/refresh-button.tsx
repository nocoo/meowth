import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, RotateCw } from 'lucide-react';
import { useRefresh } from './refresh-context';

export interface RefreshButtonProps {
  className?: string;
}

export default function RefreshButton({ className }: RefreshButtonProps) {
  const { handler, pending, trigger } = useRefresh();
  if (handler === null) return null;
  const label = pending ? 'Refreshing…' : 'Refresh page data';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('text-basalt-muted-foreground', className)}
      onClick={() => {
        void trigger();
      }}
      disabled={pending}
      aria-label={label}
      title={label}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.5} />
      ) : (
        <RotateCw className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      )}
    </Button>
  );
}
