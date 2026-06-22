import { describe, expect, it } from 'vitest';
import {
  CHART_COLORS,
  CHART_TOKENS,
  chart,
  chartAxis,
  chartNegative,
  chartPositive,
  chartPrimary,
  withAlpha,
} from './palette';

// 3.25 — pull palette.ts onto the S-tier ≥90% gate. The file is
// upstream-copied design tokens (3.13) and has no product imports
// yet, but it ships in the bundle, so the coverage gate must
// observe it as real runtime — not exempt structurally.

describe('palette', () => {
  it('withAlpha builds an hsl(... / alpha) string', () => {
    expect(withAlpha('chart-7', 0.25)).toBe('hsl(var(--chart-7) / 0.25)');
  });

  it('chart map exposes 24 entries, each wrapping a chart-N CSS var', () => {
    const entries = Object.entries(chart);
    expect(entries).toHaveLength(24);
    for (const [, value] of entries) {
      expect(value).toMatch(/^hsl\(var\(--chart-\d+\)\)$/);
    }
  });

  it('CHART_COLORS is the chart map values in declaration order', () => {
    expect(CHART_COLORS).toEqual(Object.values(chart));
    expect(CHART_COLORS[0]).toBe(chart.primary);
    expect(CHART_COLORS[23]).toBe(chart.gray);
  });

  it('CHART_TOKENS names chart-1..chart-24 in order', () => {
    expect(CHART_TOKENS).toHaveLength(24);
    expect(CHART_TOKENS[0]).toBe('chart-1');
    expect(CHART_TOKENS[23]).toBe('chart-24');
  });

  it('semantic aliases reference the documented tokens', () => {
    expect(chartAxis).toBe('hsl(var(--chart-axis))');
    expect(chartPositive).toBe(chart.green);
    expect(chartNegative).toBe('hsl(var(--destructive))');
    expect(chartPrimary).toBe(chart.primary);
  });
});
