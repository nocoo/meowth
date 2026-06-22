import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// L1 coverage for scripts/check-dashboard-source.sh (docs/architecture/07
// §5.2 + §11 G1 static `console.*` outside src/lib/logger.ts).
//
// We exercise the script against a throw-away temp tree so the
// forbidden literals never live inside apps/dashboard/src — that
// keeps production scope clean and avoids self-tripping the gate
// when it runs over real source.

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/check-dashboard-source.sh');

type RunResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function runScript(srcDir: string, htmlFile: string): RunResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT, srcDir, htmlFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: String(stdout ?? ''), stderr: '' };
  } catch (err) {
    const e = err as {
      status?: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    };
  }
}

function writeSrc(dir: string, rel: string, body: string): void {
  const full = join(dir, rel);
  const segs = rel.split('/');
  if (segs.length > 1) {
    mkdirSync(join(dir, segs.slice(0, -1).join('/')), { recursive: true });
  }
  writeFileSync(full, body, 'utf8');
}

// Build forbidden literals at runtime so this test file itself
// never contains them (the production scan covers all of
// apps/dashboard/src, but scripts/** is intentionally scoped out
// of that scan; even so we avoid carrying any forbidden string
// verbatim to keep the file robust against future scope changes).
const HTTPS = `${'h'}ttps://example.com/x.js`;
const SCRIPT_REMOTE_HTML = `<script src="${HTTPS}"></script>`;
const LINK_REMOTE_HTML = `<link rel="stylesheet" href="${HTTPS}">`;
const IMPORT_REMOTE_CSS = `@import url("${HTTPS}");`;
const EVAL_CALL = `${'ev'}al('1+1');`;
const NEW_FUNCTION_CALL = `new ${'Function'}('return 1')();`;
const DANGEROUS = `<div ${'dangerously'}SetInnerHTML={{ __html: x }} />`;
const CONSOLE_CALL = `console.${'log'}('hi');`;

let tmp: string;
let html: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meowth-source-scan-'));
  html = join(tmp, 'index.html');
  writeFileSync(html, '<!doctype html><html><head></head><body></body></html>', 'utf8');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('check-dashboard-source.sh', () => {
  it('passes a clean source tree', () => {
    writeSrc(tmp, 'clean.tsx', 'export default function Clean() { return null; }\n');
    const r = runScript(tmp, html);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('dashboard source scan: OK');
  });

  it('fails when an HTML file pulls a remote <script src>', () => {
    writeFileSync(html, `<!doctype html>${SCRIPT_REMOTE_HTML}\n`, 'utf8');
    writeSrc(tmp, 'app.tsx', 'export default function A() { return null; }\n');
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('remote <script src=> in source');
  });

  it('fails on a remote <link href>', () => {
    writeSrc(tmp, 'index.tsx', `// ${LINK_REMOTE_HTML}\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('remote <link href=> in source');
  });

  it('fails on a remote @import url() in CSS', () => {
    writeSrc(tmp, 'styles.css', `${IMPORT_REMOTE_CSS}\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('remote @import url() in source');
  });

  it('fails on a direct eval() call', () => {
    writeSrc(tmp, 'evil.ts', `${EVAL_CALL}\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('eval() in source');
  });

  it('fails on a direct new Function() call', () => {
    writeSrc(tmp, 'fn.ts', `${NEW_FUNCTION_CALL}\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('new Function() in source');
  });

  it('fails on dangerouslySetInnerHTML', () => {
    writeSrc(tmp, 'risky.tsx', `export default function R(){ return (${DANGEROUS}); }\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('dangerouslySetInnerHTML in source');
  });

  it('fails on a direct console.* outside src/lib/logger.ts', () => {
    writeSrc(tmp, 'features/Greeting.tsx', `export function g(){ ${CONSOLE_CALL} }\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('direct console.* outside src/lib/logger.ts');
  });

  it('allows console.* inside src/lib/logger.ts', () => {
    writeSrc(tmp, 'lib/logger.ts', `export function info(m: string){ ${CONSOLE_CALL} }\n`);
    const r = runScript(tmp, html);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('dashboard source scan: OK');
  });
});
