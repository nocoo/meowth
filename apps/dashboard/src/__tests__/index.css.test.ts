import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(cssDir, 'index.css'), 'utf8');

describe('dashboard design system integration', () => {
  it('scans the installed Basalt package before Tailwind', () => {
    const source = css.match(/@source\s+"([^"]+)\/\*\*/)?.[1];
    expect(source).toBeDefined();
    expect(existsSync(path.resolve(cssDir, source ?? 'missing-source'))).toBe(true);
    expect(css.indexOf('@source "')).toBeLessThan(css.indexOf('@import "tailwindcss"'));
    expect(css).toContain('@import "@nocoo/basalt/styles/tailwind"');
  });

  it('leaves surface and accent ownership to Basalt', () => {
    expect(css).not.toMatch(/--(?:basalt-)?(?:background|foreground|primary|card|muted)\s*:/);
    expect(css).not.toContain('!important');
    expect(css).toContain('bg-basalt-background text-basalt-foreground');
  });
});
