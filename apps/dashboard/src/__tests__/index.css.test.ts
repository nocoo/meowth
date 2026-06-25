import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 2 dashboard redesign Stage A2 — assert the Basalt B05 tokens
// added by `feat(dashboard): add Basalt B05 missing radius + semantic
// colors + avatar palette` are still present in `index.css`. This file
// reads the raw stylesheet text (not a Tailwind helper or palette
// utility) so the gate fails if a future refactor drops a token or a
// `@theme inline` mapping. Coverage value of the token names themselves
// is the contract — exact hsl tuples are documented in `globals.css`
// upstream and intentionally not pinned here.

const INDEX_CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css');

const css = readFileSync(INDEX_CSS_PATH, 'utf8');

function expectToken(token: string): void {
  // Match `--token:` followed by something — body of the token is the
  // hsl tuple, not the focus of this test.
  expect(css, `${token} missing from index.css`).toMatch(new RegExp(`--${token}\\s*:`));
}

describe('index.css — Stage A2 Basalt B05 tokens', () => {
  it('declares --radius-island in @theme inline', () => {
    expect(css).toMatch(/--radius-island\s*:\s*20px/);
  });

  describe('semantic color fill tokens', () => {
    it.each([
      'warning',
      'warning-foreground',
      'info',
      'info-foreground',
      'purple',
      'purple-foreground',
      'teal',
      'teal-foreground',
      'indigo',
      'indigo-foreground',
    ])('declares --%s', (name) => expectToken(name));
  });

  describe('semantic text tokens (low-contrast variants)', () => {
    it.each(['warning-text', 'info-text', 'destructive-text'])('declares --%s', (name) =>
      expectToken(name),
    );
  });

  describe('@theme inline color-* mappings', () => {
    it.each([
      'warning',
      'warning-foreground',
      'info',
      'info-foreground',
      'purple',
      'purple-foreground',
      'teal',
      'teal-foreground',
      'indigo',
      'indigo-foreground',
      'warning-text',
      'info-text',
      'destructive-text',
    ])('exposes --color-%s', (name) => expectToken(`color-${name}`));
  });

  describe('avatar palette (16 slots)', () => {
    const slots = Array.from({ length: 16 }, (_, i) => i + 1);
    it.each(slots)('declares --avatar-%i', (n) => expectToken(`avatar-${n}`));
    it.each(slots)('exposes --color-avatar-%i in @theme inline', (n) =>
      expectToken(`color-avatar-${n}`),
    );
  });

  describe('avatar palette must be present in both light and dark blocks', () => {
    const slots = Array.from({ length: 16 }, (_, i) => i + 1);
    it.each(slots)('--avatar-%i appears at least twice (light + dark)', (n) => {
      const matches = css.match(new RegExp(`--avatar-${n}\\s*:`, 'g')) ?? [];
      expect(matches.length, `avatar-${n} not declared in both blocks`).toBeGreaterThanOrEqual(2);
    });
  });

  describe('semantic colors must be present in both light and dark blocks', () => {
    it.each([
      'warning',
      'info',
      'purple',
      'teal',
      'indigo',
      'warning-text',
      'info-text',
      'destructive-text',
    ])('--%s appears at least twice (light + dark)', (name) => {
      const matches = css.match(new RegExp(`--${name}\\s*:`, 'g')) ?? [];
      expect(matches.length, `${name} not declared in both blocks`).toBeGreaterThanOrEqual(2);
    });
  });
});
