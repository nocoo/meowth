import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeToggle from './ThemeToggle';

const STORAGE_KEY = 'meowth_theme';

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
  document.documentElement.classList.remove('dark');
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
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('no stored theme + system dark → applies `dark` class', () => {
    installMatchMedia({ prefersDark: true });
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored `dark` wins over system light', () => {
    installMatchMedia({ prefersDark: false });
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored `light` wins over system dark', () => {
    installMatchMedia({ prefersDark: true });
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('malformed stored value is ignored and system preference applies', () => {
    installMatchMedia({ prefersDark: true });
    window.localStorage.setItem(STORAGE_KEY, 'midnight'); // not light|dark
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('ThemeToggle interaction', () => {
  it('clicking toggles dark class and persists to localStorage', () => {
    installMatchMedia({ prefersDark: false });
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('aria-label flips with current theme', () => {
    installMatchMedia({ prefersDark: false });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
