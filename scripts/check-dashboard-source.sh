#!/usr/bin/env bash
# Dashboard source safety gate (G1).
#
# Implements docs/architecture/07 §5.2 (remote refs / eval /
# new Function / dangerouslySetInnerHTML) and §11 G1 static
# (direct `console.*` outside `src/lib/logger.ts`).
#
# Production invocation: `pnpm scan:dashboard-source` runs with no
# arguments and scans `apps/dashboard/src` + `apps/dashboard/index.html`.
# Optional positional args make the script driveable from L1 tests
# against a throw-away temp tree.
#
#   bash scripts/check-dashboard-source.sh [SRC_DIR] [HTML_FILE]
set -euo pipefail

SRC="${1:-apps/dashboard/src}"
HTML="${2:-apps/dashboard/index.html}"

if ! command -v rg >/dev/null 2>&1; then
  echo "::error::ripgrep (rg) not installed; install it (e.g. brew install ripgrep)" >&2
  exit 2
fi

fail() {
  echo "::error::$1" >&2
  exit 1
}

# check_pattern PATTERN DESC PATH [PATH...]
# Fails fast (with rg -n output) on first hit. set -e friendly:
# the `rg` probe is wrapped in `if ... >/dev/null 2>&1; then`.
check_pattern() {
  local pattern="$1" desc="$2"
  shift 2
  if rg -n "$pattern" "$@" >/dev/null 2>&1; then
    rg -n "$pattern" "$@" >&2 || true
    fail "$desc"
  fi
}

# Filter out paths we explicitly exempt from the console rule.
# Currently only `<SRC>/lib/logger.ts` is allowed direct `console.*`
# (07 §11 G1 static / §8 logger redaction). The file does not exist
# in this phase, so the allowlist is harmless until 3.16.
check_console_outside_logger() {
  local hits
  hits=$(rg -n 'console\.(error|warn|log|info|debug|trace)\s*\(' "$SRC" 2>/dev/null || true)
  if [ -z "$hits" ]; then
    return 0
  fi
  local violations
  violations=$(echo "$hits" | grep -vE '(^|/)lib/logger\.ts:' || true)
  if [ -n "$violations" ]; then
    echo "$violations" >&2
    fail "direct console.* outside src/lib/logger.ts"
  fi
}

# 1) Remote refs in source / HTML.
check_pattern 'src=["'\'']https?://' 'remote <script src=> in source' "$SRC" "$HTML"
check_pattern 'href=["'\'']https?://' 'remote <link href=> in source' "$SRC" "$HTML"
check_pattern '@import\s+url\(["'\'']https?:' 'remote @import url() in source' "$SRC"

# 2) Dynamic code.
check_pattern 'eval\s*\(' 'eval() in source' "$SRC"
check_pattern 'new\s+Function\s*\(' 'new Function() in source' "$SRC"

# 3) dangerouslySetInnerHTML (Biome already covers; rg backstop).
check_pattern 'dangerouslySetInnerHTML' 'dangerouslySetInnerHTML in source' "$SRC"

# 4) Direct console.* outside the logger.
check_console_outside_logger

echo "dashboard source scan: OK"
