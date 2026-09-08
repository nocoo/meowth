import { Skeleton } from '@/components/ui/skeleton';

export default function ChatSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1" data-slot="chat-skeleton" aria-busy="true">
      <div className="hidden w-60 shrink-0 space-y-4 border-r border-basalt-border/60 p-4 min-[1100px]:block">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-between border-b border-basalt-border/50 px-6 py-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" data-slot="skeleton-picker" />
        </div>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 p-6">
          <div className="flex-1 space-y-5" data-slot="skeleton-messages">
            <Skeleton className="ml-auto h-12 w-2/3" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-16 w-full" data-slot="skeleton-composer" />
        </div>
      </div>
    </div>
  );
}
