import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import '@/components/chat/chat-transcript.css';

const MESSAGE_ROW_KEYS = ['m1', 'm2', 'm3'] as const;

export default function SessionDetailSkeleton() {
  return (
    <div className="chat-reading-column mx-auto min-w-0 w-full space-y-8">
      <Card className="space-y-3 p-4 sm:p-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-52" />
      </Card>
      <div className="space-y-6">
        {MESSAGE_ROW_KEYS.map((row) => (
          <div key={row} className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
