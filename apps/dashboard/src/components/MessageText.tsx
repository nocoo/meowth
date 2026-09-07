import { ansiToReactNodes } from '@/lib/ansi';
import { cn } from '@/lib/utils';

// docs/architecture/07 §3.1 — default renderer for untrusted text
// (agent stdout / stderr / generic message bodies). The text goes
// through the ANSI parser, which emits a flat list of React nodes;
// React escapes every text segment so HTML / script payloads are
// rendered as literal characters.

export interface MessageTextProps {
  content: string;
  className?: string;
}

export default function MessageText({ content, className }: MessageTextProps) {
  return (
    <pre
      className={cn(
        'min-w-0 whitespace-pre-wrap font-mono text-sm leading-relaxed [overflow-wrap:anywhere]',
        className,
      )}
    >
      {ansiToReactNodes(content)}
    </pre>
  );
}
