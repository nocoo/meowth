import { Skeleton } from '@/components/ui/skeleton';

export default function ChatSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col px-4 py-4"
      data-slot="chat-skeleton"
      aria-busy="true"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6">
        <Skeleton className="h-9 w-40" data-slot="skeleton-picker" />
        <div className="min-h-0 flex-1 space-y-4" data-slot="skeleton-messages">
          <Skeleton className="ml-auto h-12 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-3/4" />
        </div>
        <Skeleton className="h-16 w-full" data-slot="skeleton-composer" />
      </div>
    </div>
  );
}
