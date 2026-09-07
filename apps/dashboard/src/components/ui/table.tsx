import { cn } from '@/lib/utils';
import { Table as BasaltTable } from '@nocoo/basalt/components/table';
import type { ComponentProps } from 'react';

export {
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@nocoo/basalt/components/table';

export function Table({ className, ...props }: ComponentProps<typeof BasaltTable>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <BasaltTable className={cn('whitespace-nowrap', className)} {...props} />
    </div>
  );
}
