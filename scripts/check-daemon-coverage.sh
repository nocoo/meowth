#!/usr/bin/env bash
# Phase 3.25 — daemon per-package coverage gate (S-tier, baseline floors).
#
# Reads daemon/coverage.out (produced by `pnpm daemon:test:cover`) and
# computes per-package statement coverage directly from the coverprofile
# (so cmd/meowthd is excluded from the gate rather than being averaged
# into a single-total figure).
#
# Four classes of packages:
#   OK     — package ≥ DEFAULT_TARGET (95%). No baseline entry needed.
#   BASELINE
#          — package <DEFAULT_TARGET. Must not regress below its frozen
#            floor (recorded inline below). Lifting a baseline ABOVE its
#            floor is welcome; dropping BELOW its floor is a hard fail.
#            Removing a baseline entry (because the package finally
#            reaches DEFAULT_TARGET) is its own dedicated commit named
#            `test(<pkg>): lift coverage to S-tier and remove baseline`.
#            New baseline entries are FORBIDDEN — they are a regression
#            of the S-tier gate and require explicit reviewer approval.
#   EXEMPT-ENTRYPOINT
#          — program entry packages (`daemon/cmd/...`); main packages
#            without independent unit tests. Excluded by import-path
#            prefix.
#   EXEMPT-GENERATED
#          — generated code (sqlc); no test value, excluded by import-
#            path prefix.
#
# Stale baseline / exempt entries (the map names a package that no
# longer appears in the coverage report) are a hard fail so the maps
# cannot rot — every entry must match at least one package.
#
# Env knobs:
#   MIN_PCT     numeric gate target (default 95); ≥ DEFAULT_TARGET only,
#               values BELOW DEFAULT_TARGET fail-fast (the gate can only
#               be raised, never lowered).
#   COVER_FILE  path to coverprofile (default daemon/coverage.out)

set -euo pipefail

DEFAULT_TARGET=95
MIN_PCT="${MIN_PCT:-$DEFAULT_TARGET}"
COVER_FILE="${COVER_FILE:-daemon/coverage.out}"

if (( MIN_PCT < DEFAULT_TARGET )); then
  cat >&2 <<EOF
MIN_PCT($MIN_PCT) below DEFAULT_TARGET($DEFAULT_TARGET) — gates can only be raised.
EOF
  exit 2
fi

if [[ ! -f "$COVER_FILE" ]]; then
  echo "missing $COVER_FILE; run 'pnpm daemon:test:cover' first" >&2
  exit 1
fi

# Exempt prefixes. Format: `class\tprefix=reason`. `class` is
# EXEMPT-ENTRYPOINT or EXEMPT-GENERATED — kept distinct so the
# program entry is not mislabelled as generated code.
EXEMPT_PREFIXES=$(printf '%s\n' \
  'EXEMPT-ENTRYPOINT	github.com/nocoo/meowth/daemon/cmd/=program entry; main packages without independent unit tests' \
  'EXEMPT-GENERATED	github.com/nocoo/meowth/daemon/internal/store/gen=sqlc-generated SQL bindings; regenerated from queries.sql' \
)

# Baseline floors. Package import path → minimum percent (integer).
# Values are the floor BELOW which coverage cannot drop; they are
# NOT the target — the target is DEFAULT_TARGET. Once the package
# reaches DEFAULT_TARGET, delete its baseline entry in a dedicated
# commit named `test(<pkg>): lift coverage to S-tier and remove baseline`.
BASELINE_FLOORS=$(cat <<'EOF'
github.com/nocoo/meowth/daemon/internal/server/handlers=69
github.com/nocoo/meowth/daemon/internal/envelope=72
github.com/nocoo/meowth/daemon/internal/store=75
# internal/server has nondeterministic coverage (73.8–76.2% across
# sampled runs) — its store-related branches race during init.
# Floor 73 covers the observed minimum with headroom; tighten in
# the eventual `test(internal/server): lift to S-tier` commit.
github.com/nocoo/meowth/daemon/internal/server=73
github.com/nocoo/meowth/daemon/internal/server/testbackend=76
github.com/nocoo/meowth/daemon/internal/home=79
github.com/nocoo/meowth/daemon/internal/initcmd=79
github.com/nocoo/meowth/daemon/pkg/agent=82
github.com/nocoo/meowth/daemon/internal/bootstraptoken=82
github.com/nocoo/meowth/daemon/internal/remoteaccess=85
github.com/nocoo/meowth/daemon/internal/server/mint=85
github.com/nocoo/meowth/daemon/internal/server/static=90
github.com/nocoo/meowth/daemon/internal/setupnonce=91
github.com/nocoo/meowth/daemon/internal/agentfactory=93
github.com/nocoo/meowth/daemon/internal/server/auth=94
EOF
)

awk \
  -v TARGET="$MIN_PCT" \
  -v EXEMPT_DATA_FILE=<(printf '%s\n' "$EXEMPT_PREFIXES") \
  -v BASELINE_DATA_FILE=<(printf '%s\n' "$BASELINE_FLOORS") '
  BEGIN {
    n_exempt_prefix = 0
    while ((getline line < EXEMPT_DATA_FILE) > 0) {
      if (line == "") continue
      tab = index(line, "\t")
      if (tab == 0) continue
      class = substr(line, 1, tab - 1)
      rest = substr(line, tab + 1)
      eq = index(rest, "=")
      if (eq == 0) continue
      n_exempt_prefix++
      exempt_class[n_exempt_prefix] = class
      exempt_prefix[n_exempt_prefix] = substr(rest, 1, eq - 1)
      exempt_reason[n_exempt_prefix] = substr(rest, eq + 1)
      exempt_matched[n_exempt_prefix] = 0
    }
    close(EXEMPT_DATA_FILE)
    while ((getline line < BASELINE_DATA_FILE) > 0) {
      if (line == "") continue
      eq = index(line, "=")
      if (eq == 0) continue
      baseline[substr(line, 1, eq - 1)] = substr(line, eq + 1) + 0
    }
    close(BASELINE_DATA_FILE)
  }

  /^mode:/ { next }

  {
    n = split($1, parts, "/")
    pkg = parts[1]
    for (i = 2; i < n; i++) pkg = pkg "/" parts[i]

    stmts = $2 + 0
    count = $3 + 0
    total[pkg] += stmts
    if (count > 0) covered[pkg] += stmts
  }

  function exempt_index_of(pkg,    j) {
    for (j = 1; j <= n_exempt_prefix; j++) {
      if (index(pkg, exempt_prefix[j]) == 1) return j
    }
    return 0
  }

  END {
    fail = 0
    baseline_count = 0
    entrypoint_count = 0
    generated_count = 0
    ok_count = 0
    for (pkg in total) {
      ex = exempt_index_of(pkg)
      if (ex > 0) {
        exempt_matched[ex]++
        printf "%-17s %-55s  reason=%s\n", exempt_class[ex], pkg, exempt_reason[ex]
        if (exempt_class[ex] == "EXEMPT-ENTRYPOINT") entrypoint_count++
        else if (exempt_class[ex] == "EXEMPT-GENERATED") generated_count++
        continue
      }
      tot = total[pkg]
      cov = (pkg in covered) ? covered[pkg] : 0
      pct = (tot == 0) ? 0 : (cov * 100.0) / tot
      if (pkg in baseline) {
        baseline_seen[pkg] = 1
        floor = baseline[pkg]
        if (pct + 0 < floor + 0) {
          printf "FAIL              %-55s  %6.1f%%  baseline_floor=%d target=%d\n", pkg, pct, floor, TARGET > "/dev/stderr"
          fail = 1
        } else {
          printf "BASELINE          %-55s  %6.1f%%  (floor=%d, target=%d)\n", pkg, pct, floor, TARGET
          baseline_count++
        }
      } else {
        if (pct + 0 < TARGET + 0) {
          printf "FAIL              %-55s  %6.1f%%  target=%d (no baseline allowed; lift to ≥%d)\n", pkg, pct, TARGET, TARGET > "/dev/stderr"
          fail = 1
        } else {
          printf "OK                %-55s  %6.1f%%  (≥%d)\n", pkg, pct, TARGET
          ok_count++
        }
      }
    }
    # Stale baseline entries: the map names a package no longer in
    # the coverage report (file deleted, package renamed, scope
    # narrowed). Treat as a hard fail so map rot is impossible.
    for (pkg in baseline) {
      if (!(pkg in baseline_seen)) {
        printf "FAIL              %-55s  baseline entry stale; package not in coverage report\n", pkg > "/dev/stderr"
        fail = 1
      }
    }
    # Stale exempt prefixes: every declared exempt prefix must match
    # at least one observed package.
    for (j = 1; j <= n_exempt_prefix; j++) {
      if (exempt_matched[j] == 0) {
        printf "FAIL              %-55s  %s prefix stale; no package matches\n", exempt_prefix[j], exempt_class[j] > "/dev/stderr"
        fail = 1
      }
    }
    printf "\nSummary: target=%d%%  ok=%d  baseline_floors=%d  entrypoint_exempt=%d  generated_exempt=%d\n", TARGET, ok_count, baseline_count, entrypoint_count, generated_count
    if (fail) exit 1
  }
' "$COVER_FILE"
