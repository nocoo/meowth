import { THEME_STORAGE_KEY } from '@/lib/theme-init';
import { ThemeProvider } from '@nocoo/basalt/providers/theme';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeToggle from './ThemeToggle';

interface MatchMediaState {
  prefersDark: boolean;
}

function installMatchMedia(state: MatchMediaState): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const matches = query === '(prefers-color-scheme: dark)' ? state.prefersDark : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

function resetTheme(): void {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-mode');
}

function renderToggle() {
  return render(
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  resetTheme();
});

afterEach(() => {
  cleanup();
  resetTheme();
});

describe('ThemeToggle initial theme resolution', () => {
  it('no stored theme + system light → no `dark` class', () => {
    installMatchMedia({ prefersDark: false });
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('no stored theme + system dark → applies `dark` class', () => {
    installMatchMedia({ prefersDark: true });
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored `dark` wins over system light', () => {
    installMatchMedia({ prefersDark: false });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored `light` wins over system dark', () => {
    installMatchMedia({ prefersDark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('malformed stored value is ignored and system preference applies', () => {
    installMatchMedia({ prefersDark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('ThemeToggle interaction', () => {
  it('clicking toggles dark class and persists to localStorage', () => {
    installMatchMedia({ prefersDark: false });
    renderToggle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('aria-label flips with current theme', () => {
    installMatchMedia({ prefersDark: false });
    renderToggle();
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('keeps both light/dark classes and data-mode in sync', () => {
    installMatchMedia({ prefersDark: false });
    renderToggle();
    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
  });

  it('renders an h-4 w-4 icon inside the button', () => {
    installMatchMedia({ prefersDark: false });
    const { container } = renderToggle();
    const icon = container.querySelector('button svg');
    expect(icon).not.toBeNull();
    const iconClass = icon?.getAttribute('class') ?? '';
    expect(iconClass).toContain('h-4');
    expect(iconClass).toContain('w-4');
  });
});
