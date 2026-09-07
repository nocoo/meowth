import { ansiToPlainText } from '@/lib/ansi';
import { displayLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Code, CodeHighlighted } from '@nocoo/basalt/components/code';
import { type ReactElement, memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CopyButton from './CopyButton';
import './message-markdown.css';

const LANGUAGE_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
  py: 'Python',
  md: 'Markdown',
};

function MarkdownCode({ children }: { children?: React.ReactNode }) {
  const code = children as ReactElement<{ children?: string; className?: string }>;
  const content = String(code.props.children ?? '').replace(/\n$/, '');
  const language = /language-([^\s]+)/.exec(code.props.className ?? '')?.[1] ?? 'text';
  const label = LANGUAGE_LABELS[language] ?? displayLabel(language);

  return (
    <div className="chat-code" data-language={language}>
      <div className="flex items-center justify-between gap-3 border-b border-basalt-border/60 px-3 py-1.5">
        <span className="text-xs font-medium text-basalt-muted-foreground">{label}</span>
        <CopyButton text={content} label="Copy code" />
      </div>
      <CodeHighlighted
        code={content}
        aria-label={`${label} code`}
        tabIndex={0}
        className="max-w-full rounded-none border-0 bg-transparent p-4 text-[13px] shadow-none ring-0"
      />
    </div>
  );
}

const components: Components = {
  pre: MarkdownCode,
  code: ({ children }) => <Code>{children}</Code>,
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        Image: {alt || 'Open image'}
      </a>
    ) : (
      <span>{alt}</span>
    ),
  table: ({ children }) => (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard focus for horizontal navigation.
    <section className="chat-table" aria-label="Table" tabIndex={0}>
      <table>{children}</table>
    </section>
  ),
};

const MessageMarkdown = memo(function MessageMarkdown({
  content,
  className,
}: { content: string; className?: string }) {
  return (
    <div className={cn('chat-markdown min-w-0', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {ansiToPlainText(content)}
      </Markdown>
    </div>
  );
});

export default MessageMarkdown;
