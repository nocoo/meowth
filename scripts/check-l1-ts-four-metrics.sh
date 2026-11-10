#!/usr/bin/env bash
# L1 — merged TypeScript four-metric gate (dashboard + shared vitest summaries).
#
# Sums statements/branches/functions/lines across workspace coverage-summary
# JSON files and requires each metric ≥ MIN_PCT (default 95). Shared has no
# branches in scope; branch totals still merge arithmetically.

set -euo pipefail

MIN_PCT="${MIN_PCT:-95}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY_FILES=(
  "$REPO_ROOT/apps/dashboard/coverage/coverage-summary.json"
  "$REPO_ROOT/packages/shared/coverage/coverage-summary.json"
)

for f in "${SUMMARY_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "missing $f; run 'pnpm dashboard:test:cover' first" >&2
    exit 1
  fi
done

export MIN_PCT REPO_ROOT
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const MIN_PCT = Number(process.env.MIN_PCT);
const root = process.env.REPO_ROOT;
if (!root) {
  console.error('REPO_ROOT is required');
  process.exit(2);
}

// Same structural shells/barrels as scripts/check-dashboard-coverage.sh.
const STRUCTURAL_EXEMPT = new Set([
  'apps/dashboard/src/main.tsx',
  'apps/dashboard/src/App.tsx',
  'apps/dashboard/src/routes/index.tsx',
  'apps/dashboard/src/pages/Agents/index.ts',
  'apps/dashboard/src/pages/Chat/index.ts',
  'apps/dashboard/src/pages/Overview/index.ts',
  'apps/dashboard/src/pages/Sessions/index.ts',
  'apps/dashboard/src/pages/Settings/index.ts',
  'apps/dashboard/src/pages/Setup/index.ts',
  'apps/dashboard/src/pages/Tokens/index.ts',
  'apps/dashboard/src/components/layout/index.ts',
]);

const files = [
  'apps/dashboard/coverage/coverage-summary.json',
  'packages/shared/coverage/coverage-summary.json',
].map((rel) => path.join(root, rel));

const metrics = ['statements', 'branches', 'functions', 'lines'];
const merged = Object.fromEntries(metrics.map((m) => [m, { total: 0, covered: 0 }]));

for (const file of files) {
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [absKey, perFile] of Object.entries(summary)) {
    if (absKey === 'total') continue;
    const rel = path.relative(root, absKey);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (STRUCTURAL_EXEMPT.has(rel)) continue;
    for (const key of metrics) {
      const entry = perFile[key];
      if (!entry || typeof entry.total !== 'number') continue;
      merged[key].total += entry.total;
      merged[key].covered += entry.covered ?? 0;
    }
  }
}

let fail = 0;
for (const key of metrics) {
  const { total, covered } = merged[key];
  const pct = total === 0 ? 100 : (covered * 100) / total;
  const rounded = Math.floor(pct * 100) / 100;
  const ok = pct + 1e-9 >= MIN_PCT;
  const label = ok ? 'OK' : 'FAIL';
  console.log(
    `${label}  ${key.padEnd(12)}  ${covered}/${total}  ${rounded.toFixed(2)}%  (floor=${MIN_PCT}%)`,
  );
  if (!ok) fail = 1;
}
process.exit(fail);
NODE
