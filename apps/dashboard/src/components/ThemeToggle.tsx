import { cn } from '@/lib/utils';
import { Button } from '@nocoo/basalt';
import { type BasaltTheme, useTheme } from '@nocoo/basalt/providers/theme';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolvedDark(theme: BasaltTheme, systemDark: boolean): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

export interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const isDark = resolvedDark(theme, systemDark);
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
      )}
    </Button>
  );
}
