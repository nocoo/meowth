import { cn } from '@/lib/utils';
import { Button } from '@nocoo/basalt';
import { type BasaltTheme, useTheme } from '@nocoo/basalt/providers/theme';
import { Moon, Sun } from 'lucide-react';

function resolvedDark(theme: BasaltTheme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const isDark = resolvedDark(theme);
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
