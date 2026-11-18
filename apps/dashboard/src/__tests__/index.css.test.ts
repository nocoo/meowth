import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(cssDir, 'index.css'), 'utf8');

describe('dashboard design system integration', () => {
  it("uses Basalt's embedded source scan with two-line CSS imports", () => {
    expect(css.trimStart().split('\n').slice(0, 2)).toEqual([
      '@import "@nocoo/basalt/styles";',
      '@import "tailwindcss";',
    ]);
    expect(css).not.toContain('@source ');
    expect(
      readFileSync(
        path.resolve(cssDir, '../node_modules/@nocoo/basalt/dist/styles/tailwind.css'),
        'utf8',
      ),
    ).toContain('@source "../**/*.js";');
  });

  it('leaves surface and accent ownership to Basalt', () => {
    expect(css).not.toMatch(/--(?:basalt-)?(?:background|foreground|primary|card|muted)\s*:/);
    expect(css).not.toContain('!important');
    expect(css).toContain('bg-basalt-background text-basalt-foreground');
  });
});
