import { LayerCard } from '@nocoo/basalt';
import { Skeleton } from '@nocoo/basalt/components/skeleton';

export default function SessionDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8" aria-busy="true">
      <LayerCard outlined padding="none" className="space-y-3 p-4 sm:p-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-52" />
      </LayerCard>
      <div className="space-y-4" data-testid="session-messages-loading">
        {['first', 'second', 'third'].map((row) => (
          <div key={row} className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
