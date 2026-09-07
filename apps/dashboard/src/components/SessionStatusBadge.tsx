import { Badge } from '@/components/ui/badge';
import { displayLabel } from '@/lib/labels';

const VARIANTS: Record<string, 'success' | 'error' | 'info'> = {
  completed: 'success',
  failed: 'error',
  error: 'error',
  running: 'info',
};

export default function SessionStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANTS[status] ?? 'secondary'} dot>
      {displayLabel(status)}
    </Badge>
  );
}
