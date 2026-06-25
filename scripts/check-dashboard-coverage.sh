#!/usr/bin/env bash
# Phase 3.25 — dashboard L1 coverage gate (S-tier, baseline floors).
#
# Reads vitest v8 json-summary reports for both workspaces:
#   apps/dashboard/coverage/coverage-summary.json
#   packages/shared/coverage/coverage-summary.json
#
# Three classes of files (same governance as scripts/check-daemon-coverage.sh):
#   OK     — file ≥ DEFAULT_TARGET (90%). No baseline entry needed.
#   BASELINE
#          — file <DEFAULT_TARGET. Must not regress below its frozen
#            floor (recorded inline below). Lifting a baseline ABOVE its
#            floor is welcome; dropping BELOW its floor is a hard fail.
#            Removing a baseline entry (because the file reaches
#            DEFAULT_TARGET) is its own dedicated commit named
#            `test(dashboard): lift <file> to S-tier and remove baseline`.
#            New baseline entries are FORBIDDEN.
#   EXEMPT-STRUCTURAL
#          — non-runtime structural files (barrel re-exports, router
#            assembly shell, ReactDOM bootstrap). Each entry has an
#            inline reason; they are excluded from the gate entirely.
#
# Env knobs:
#   MIN_PCT     numeric gate target (default 90); values BELOW the
#               default fail-fast (gates can only be raised).

set -euo pipefail

DEFAULT_TARGET=90
MIN_PCT="${MIN_PCT:-$DEFAULT_TARGET}"

if (( MIN_PCT < DEFAULT_TARGET )); then
  cat >&2 <<EOF
MIN_PCT($MIN_PCT) below DEFAULT_TARGET($DEFAULT_TARGET) — gates can only be raised.
EOF
  exit 2
fi

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

# Exempt-structural file list. Each entry is a repo-relative path that
# must not enter the coverage gate. Reasons are reported inline.
EXEMPT_STRUCTURAL=$(cat <<'EOF'
apps/dashboard/src/main.tsx=ReactDOM.createRoot bootstrap; no independent unit test value
apps/dashboard/src/App.tsx=top-level router shell; covered by L3 routing
apps/dashboard/src/routes/index.tsx=route table assembly; covered by L3 routing
apps/dashboard/src/pages/Agents/index.ts=barrel re-export
apps/dashboard/src/pages/Overview/index.ts=barrel re-export
apps/dashboard/src/pages/Sessions/index.ts=barrel re-export
apps/dashboard/src/pages/Settings/index.ts=barrel re-export
apps/dashboard/src/pages/Setup/index.ts=barrel re-export
apps/dashboard/src/pages/Tokens/index.ts=barrel re-export
apps/dashboard/src/components/layout/index.ts=barrel re-export
EOF
)

# Baseline floors. repo-relative file → minimum statements percent (integer).
# Floor is the regression bar; the target is DEFAULT_TARGET. Lift a file
# above DEFAULT_TARGET and drop its baseline entry in a dedicated
# follow-up commit.
BASELINE_FLOORS=$(cat <<'EOF'
apps/dashboard/src/lib/ansi.ts=87
apps/dashboard/src/pages/Tokens/TokensPage.tsx=53
apps/dashboard/src/viewmodels/useSessionDetailViewModel.ts=82
apps/dashboard/src/viewmodels/useTokensViewModel.ts=82
EOF
)

# Build a single tab-separated stream of `repo_relative_path\tpct` for
# every covered file across both workspaces. Node 22+ provides the
# JSON parser; we relativize the absolute keys vitest emits so the
# baseline map only ever uses stable repo-relative paths.
ENTRIES=$(REPO_ROOT="$REPO_ROOT" node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.REPO_ROOT;
const paths = process.argv.slice(1);
let lines = [];
for (const p of paths) {
  const summary = JSON.parse(fs.readFileSync(p, "utf8"));
  let matched = 0;
  for (const [absKey, metrics] of Object.entries(summary)) {
    if (absKey === "total") continue;
    if (!path.isAbsolute(absKey)) {
      throw new Error(`unexpected non-absolute key in ${p}: ${absKey}`);
    }
    const rel = path.relative(root, absKey);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`key escapes repo root: ${absKey} → ${rel}`);
    }
    matched++;
    lines.push(`${rel}\t${metrics.statements.pct.toFixed(2)}`);
  }
  if (matched === 0) {
    throw new Error(`no entries in ${p}; coverage report empty?`);
  }
}
process.stdout.write(lines.join("\n") + "\n");
' "${SUMMARY_FILES[@]}")

echo "$ENTRIES" | awk \
  -v TARGET="$MIN_PCT" \
  -v EXEMPT_DATA_FILE=<(printf '%s\n' "$EXEMPT_STRUCTURAL") \
  -v BASELINE_DATA_FILE=<(printf '%s\n' "$BASELINE_FLOORS") '
  BEGIN {
    FS = "\t"
    while ((getline line < EXEMPT_DATA_FILE) > 0) {
      if (line == "") continue
      eq = index(line, "=")
      if (eq == 0) continue
      exempt[substr(line, 1, eq - 1)] = substr(line, eq + 1)
    }
    close(EXEMPT_DATA_FILE)
    while ((getline line < BASELINE_DATA_FILE) > 0) {
      if (line == "") continue
      eq = index(line, "=")
      if (eq == 0) continue
      baseline[substr(line, 1, eq - 1)] = substr(line, eq + 1) + 0
    }
    close(BASELINE_DATA_FILE)
    fail = 0
    ok_count = 0
    baseline_count = 0
    exempt_count = 0
    exempt_used_count = 0
  }

  {
    rel = $1
    pct = $2 + 0
    if (rel in exempt) {
      printf "EXEMPT-STRUCTURAL  %-65s  reason=%s\n", rel, exempt[rel]
      exempt_used[rel] = 1
      exempt_used_count++
      next
    }
    if (rel in baseline) {
      floor = baseline[rel]
      if (pct + 0 < floor + 0) {
        printf "FAIL               %-65s  %6.2f%%  baseline_floor=%d target=%d\n", rel, pct, floor, TARGET > "/dev/stderr"
        fail = 1
      } else {
        printf "BASELINE           %-65s  %6.2f%%  (floor=%d, target=%d)\n", rel, pct, floor, TARGET
        baseline_count++
      }
      baseline_seen[rel] = 1
      next
    }
    if (pct + 0 < TARGET + 0) {
      printf "FAIL               %-65s  %6.2f%%  target=%d (no baseline allowed; lift to ≥%d)\n", rel, pct, TARGET, TARGET > "/dev/stderr"
      fail = 1
    } else {
      printf "OK                 %-65s  %6.2f%%  (≥%d)\n", rel, pct, TARGET
      ok_count++
    }
  }

  END {
    # Stale baseline/exempt entries (the file no longer appears in
    # the coverage report) are a hard error so the map cannot rot.
    for (f in baseline) {
      if (!(f in baseline_seen)) {
        printf "FAIL               %-65s  baseline entry stale; file not in coverage report\n", f > "/dev/stderr"
        fail = 1
      }
    }
    for (f in exempt) {
      if (!(f in exempt_used)) {
        printf "FAIL               %-65s  exempt-structural entry stale; file not in coverage report\n", f > "/dev/stderr"
        fail = 1
      }
    }
    # Total expected exempt entries vs entries actually used.
    expected_exempt = 0
    for (f in exempt) expected_exempt++
    printf "\nSummary: target=%d%%  ok=%d  baseline_floors=%d  structural_exempt=%d\n", TARGET, ok_count, baseline_count, expected_exempt
    if (fail) exit 1
  }
'
