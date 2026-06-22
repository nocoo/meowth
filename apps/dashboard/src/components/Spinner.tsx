import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// docs/architecture/06 §4.1.3: meowth-local addition. basalt has
// no Spinner; we use lucide-react's Loader2 with Tailwind's
// animate-spin utility.
export interface SpinnerProps {
  className?: string;
  label?: string;
}

export default function Spinner({ className, label = 'Loading…' }: SpinnerProps) {
  return (
    <Loader2 role="status" aria-label={label} className={cn('h-4 w-4 animate-spin', className)} />
  );
}
