import { Badge } from '@nocoo/basalt';
import type { BadgeTone } from '@nocoo/basalt/components/badge';
import { displayLabel } from '@/lib/labels';

const TONES: Record<string, BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  error: 'danger',
  running: 'info',
};

export default function SessionStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={TONES[status] ?? 'neutral'} dot>
      {displayLabel(status)}
    </Badge>
  );
}
