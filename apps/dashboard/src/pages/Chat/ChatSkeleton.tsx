import { Skeleton } from '@/components/ui/skeleton';

export default function ChatSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1" data-slot="chat-skeleton" aria-busy="true">
      <div className="hidden w-56 shrink-0 space-y-4 border-r border-basalt-border/50 p-4 min-[1100px]:block">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 px-6">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-7 w-28" data-slot="skeleton-picker" />
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
          <div className="flex flex-col items-center gap-4" data-slot="skeleton-messages">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-9 w-56 max-w-full" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-32 w-full rounded-3xl" data-slot="skeleton-composer" />
        </div>
      </div>
    </div>
  );
}
