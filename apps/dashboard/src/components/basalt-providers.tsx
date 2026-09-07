import { THEME_STORAGE_KEY } from '@/lib/theme-init';
import { LinkProvider, Toaster, TooltipProvider } from '@nocoo/basalt';
import { AccentProvider } from '@nocoo/basalt/providers/accent';
import { ThemeProvider } from '@nocoo/basalt/providers/theme';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export const MEOWTH_ACCENT = {
  primary: { light: '217 91% 60%', dark: '217 91% 65%' },
} as const;

export function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {children}
    </Link>
  );
}

export function BasaltRouteProviders({ children }: { children: ReactNode }) {
  return <LinkProvider render={AppLink}>{children}</LinkProvider>;
}

export function BasaltProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <AccentProvider defaultAccent="primary" persist={false} paletteOverrides={MEOWTH_ACCENT}>
        <TooltipProvider>
          <Toaster />
          {children}
        </TooltipProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
