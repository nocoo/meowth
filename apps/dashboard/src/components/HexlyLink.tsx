import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@nocoo/basalt';

export function HexlyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4 pointer-events-none'}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2 8.66 5v10L12 22l-8.66-5V7Z" />
      <path d="M12 2v20M3.34 7l17.32 10m0-10L3.34 17" />
    </svg>
  );
}

export function HexlyLink({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className={cn('text-basalt-muted-foreground', className)}
        >
          <a
            href="https://hexly.ai/projects/meowth"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Meowth on hexly.ai (opens in a new tab)"
          >
            <HexlyIcon />
            <span className="sr-only">Meowth on hexly.ai</span>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Meowth on hexly.ai</TooltipContent>
    </Tooltip>
  );
}
