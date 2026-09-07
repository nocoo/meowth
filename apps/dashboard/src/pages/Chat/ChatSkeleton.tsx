import { Skeleton } from '@/components/ui/skeleton';
import { LayerCard } from '@nocoo/basalt';

// docs/features/03 §4.4 — pre-/v1/agents skeleton. Reserves the
// same vertical footprint as ChatContent (picker / list / composer)
// so the swap to live content does not visibly reflow.

export default function ChatSkeleton() {
  return (
    <LayerCard
      className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3"
      data-slot="chat-skeleton"
    >
      <Skeleton className="h-9 w-40" data-slot="skeleton-picker" />
      <div className="min-h-0 flex-1 space-y-2" data-slot="skeleton-messages">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
      <Skeleton className="h-16 w-full" data-slot="skeleton-composer" />
    </LayerCard>
  );
}
