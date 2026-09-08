import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@nocoo/basalt/components/collapsible';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export default function ActivityDisclosure({
  label,
  icon: Icon,
  children,
  kind,
  busy = false,
  description,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  kind: string;
  busy?: boolean;
  description?: string;
}) {
  return (
    <Collapsible data-bubble-kind={kind} className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={label}
          className="group -ml-2 h-auto min-h-9 max-w-full justify-start gap-2 px-2 py-1.5 text-left font-normal text-basalt-muted-foreground hover:text-basalt-foreground"
        >
          <Icon
            className={`h-4 w-4 shrink-0 ${busy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-[13px]">{label}</span>
          {description ? (
            <span className="hidden min-w-0 truncate text-xs opacity-80 sm:inline">
              {description}
            </span>
          ) : null}
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent unstyled>
        <div className="mt-1 mb-3 ml-2 min-w-0 space-y-4 border-l border-basalt-border/70 py-2 pr-1 pl-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
