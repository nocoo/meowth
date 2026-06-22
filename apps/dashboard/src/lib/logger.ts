// docs/architecture/07 §8.2 — the ONLY file in apps/dashboard/src
// that may call console.* directly. All other code must import
// `logger` from here; the G1 source-scan (scripts/check-dashboard-source.sh)
// allowlists this file.
//
// Every argument is normalised to a string and passed through
// `redact()` so token / setup-code / Authorization values cannot
// leak through logs, error overlays, or telemetry sinks.

import { redact } from '@/lib/redact';

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function pipeline(args: unknown[]): string[] {
  return args.map((a) => redact(safeStringify(a)));
}

export const logger = {
  info(...args: unknown[]): void {
    console.info(...pipeline(args));
  },
  warn(...args: unknown[]): void {
    console.warn(...pipeline(args));
  },
  error(...args: unknown[]): void {
    console.error(...pipeline(args));
  },
  debug(...args: unknown[]): void {
    console.debug(...pipeline(args));
  },
};
