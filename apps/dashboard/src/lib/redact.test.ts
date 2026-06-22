import { describe, expect, it } from 'vitest';
import { redact } from './redact';

// docs/architecture/07 §8.3 — reflect tests for the redactor.
// Covers tokens (mwt_*), setup-codes (mws_*), Authorization
// header, and a fuzz pass that guarantees no [A-Z0-9]{30,} run
// survives outside of an mwt_/mws_ prefix.

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randSecret(prefix: string, len: number): string {
  let out = prefix;
  for (let i = 0; i < len; i++) out += ALPHA[Math.floor((i * 37 + len) % ALPHA.length)];
  return out;
}

describe('redact — tokens', () => {
  it('redacts a bare mwt_ token (>=30 alnum chars)', () => {
    const token = `mwt_${'A'.repeat(40)}`;
    expect(redact(token)).toBe('mwt_<redacted>');
  });

  it('redacts an mwt_ token in the middle of a sentence', () => {
    const token = `mwt_${'B'.repeat(32)}`;
    const out = redact(`token=${token} fyi`);
    expect(out).toBe('token=mwt_<redacted> fyi');
  });

  it('leaves a short mwt_ value (<30 chars) alone', () => {
    const short = 'mwt_ABC123';
    expect(redact(short)).toBe(short);
  });
});

describe('redact — setup codes', () => {
  it('redacts a bare mws_ setup-code (>=30 alnum chars)', () => {
    const code = `mws_${'C'.repeat(40)}`;
    expect(redact(code)).toBe('mws_<redacted>');
  });

  it('redacts mws_ inline (setup-code embedded in a long string)', () => {
    const code = `mws_${'D'.repeat(40)}`;
    const out = redact(`setup link https://x/y?code=${code} now`);
    expect(out).toContain('mws_<redacted>');
    expect(out).not.toContain(code);
  });
});

describe('redact — Authorization header', () => {
  it('redacts the full Authorization: Bearer mwt_... shape', () => {
    const header = `Authorization: Bearer mwt_${'E'.repeat(40)}`;
    expect(redact(header)).toBe('Authorization: Bearer mwt_<redacted>');
  });

  it('redacts Authorization with extra surrounding text', () => {
    const header = `Authorization: Bearer mwt_${'F'.repeat(40)}`;
    const out = redact(`req: ${header} ok`);
    expect(out).toBe('req: Authorization: Bearer mwt_<redacted> ok');
  });
});

describe('redact — non-matches', () => {
  it('leaves plain text untouched', () => {
    expect(redact('hello world 42')).toBe('hello world 42');
  });

  it('does not match lowercase 30-char runs (regex requires [A-Z0-9])', () => {
    const lower = `mwt_${'a'.repeat(40)}`;
    expect(redact(lower)).toBe(lower);
  });
});

describe('redact — fuzz', () => {
  it('removes every [A-Z0-9]{30,} run unless it is exactly the prefix marker', () => {
    for (let i = 0; i < 100; i++) {
      const t = randSecret('mwt_', 30 + (i % 40));
      const s = randSecret('mws_', 30 + ((i + 7) % 40));
      const noise = `prefix ${t} mid ${s} tail`;
      const out = redact(noise);
      // After redact, the remaining alnum runs of >=30 should not exist.
      const stripped = out.replace(/mwt_<redacted>/g, '').replace(/mws_<redacted>/g, '');
      expect(stripped).not.toMatch(/[A-Z0-9]{30,}/);
    }
  });
});
