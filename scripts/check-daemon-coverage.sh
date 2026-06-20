#!/usr/bin/env bash
# Phase 2.6 — daemon per-package coverage gate (PLACEHOLDER threshold).
#
# Reads daemon/coverage.out (produced by `pnpm daemon:test:cover`) and
# computes per-package statement coverage directly from the coverprofile
# (so cmd/meowthd is excluded from the gate rather than being averaged
# into a single-total figure).
#
# Threshold is 0% by default (placeholder; this commit only wires the
# harness). Phase 3.25 (`chore: bump coverage thresholds to S-tier`)
# raises the default to 95.
#
# Env overrides:
#   MIN_PCT     numeric gate (default 0)
#   COVER_FILE  path to coverprofile (default daemon/coverage.out)

set -euo pipefail

MIN_PCT="${MIN_PCT:-0}"
COVER_FILE="${COVER_FILE:-daemon/coverage.out}"
EXEMPT_PREFIX='github.com/nocoo/meowth/daemon/cmd/'

if [[ ! -f "$COVER_FILE" ]]; then
  echo "missing $COVER_FILE; run 'pnpm daemon:test:cover' first" >&2
  exit 1
fi

awk -v MIN="$MIN_PCT" -v EXEMPT="$EXEMPT_PREFIX" '
  # Skip mode header (e.g. "mode: count").
  /^mode:/ { next }

  # Coverprofile line: "<file>:<startLine>.<startCol>,<endLine>.<endCol> numStmts count"
  {
    # field 1 is "<importPath>/<file>:<range>"; package = dirname of import path.
    n = split($1, parts, "/")
    pkg = parts[1]
    for (i = 2; i < n; i++) pkg = pkg "/" parts[i]
    # parts[n] looks like "agent.go:56.99,57.17"; nothing else to do, pkg drops the file segment.

    # Skip exempt packages (e.g. cmd/meowthd).
    if (index(pkg, EXEMPT) == 1) next

    stmts = $2 + 0
    count = $3 + 0
    total[pkg] += stmts
    if (count > 0) covered[pkg] += stmts
  }

  END {
    fail = 0
    for (pkg in total) {
      tot = total[pkg]
      cov = (pkg in covered) ? covered[pkg] : 0
      if (tot == 0) {
        pct = 0
      } else {
        pct = (cov * 100.0) / tot
      }
      if (pct + 0 < MIN + 0) {
        printf "FAIL  %-60s  %6.1f%%  (gate=%s%%)\n", pkg, pct, MIN > "/dev/stderr"
        fail = 1
      } else {
        printf "OK    %-60s  %6.1f%%\n", pkg, pct
      }
    }
    if (fail) exit 1
  }
' "$COVER_FILE"
