import { cn } from '@/lib/utils';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

// docs/architecture/06 §4.1.2: meowth-local ThemeToggle (not a
// verbatim copy of basalt). Behaviour:
//
//   - On mount: if localStorage `meowth_theme` is `dark` or
//     `light`, that wins. Otherwise the system preference
//     (`prefers-color-scheme: dark`) decides.
//   - Toggling persists to localStorage and flips
//     `document.documentElement.classList.toggle('dark')`.
//   - Malformed stored values are ignored — system preference
//     applies and the bad value is removed on the next toggle.
//
// No i18n / cmdk / LanguageToggle dependencies, per 06 §4.1.2.

const STORAGE_KEY = 'meowth_theme';

type Theme = 'dark' | 'light';

function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light';
}

function readStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    if (!isTheme(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme): void {
  const cls = document.documentElement.classList;
  if (theme === 'dark') {
    cls.add('dark');
  } else {
    cls.remove('dark');
  }
}

function resolveInitialTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return systemPrefersDark() ? 'dark' : 'light';
}

export interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort; ignore quota / private mode rejection
    }
    setTheme(next);
  };

  const Icon = theme === 'dark' ? Sun : Moon;
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
