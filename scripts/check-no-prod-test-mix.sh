#!/usr/bin/env bash
# scripts/check-no-prod-test-mix.sh — D1 static check per
# docs/architecture/03-sqlite-schema-and-tokens.md §9.4.
#
# Refuses to commit code where:
#   - The literal "~/.meowth-test/" appears outside test files
#     (whitelisted in *_test.go files).
#   - The literal "~/.meowth/" appears outside the production home
#     resolver (`daemon/internal/home/home.go`) or doc trees.
#
# The check operates on the working tree, not git history — that
# matches pre-commit / pre-push expectations.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

fail=0

# ---- ~/.meowth-test/ may only appear in tests ----
# Allow inside *_test.go (tests) and inside this script itself + docs.
mapfile -t test_misplaced < <(grep -RIn --include='*.go' --include='*.ts' --include='*.sh' \
  --exclude='*_test.go' --exclude='check-no-prod-test-mix.sh' \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=pkg \
  "~/.meowth-test/" daemon scripts 2>/dev/null || true)
if (( ${#test_misplaced[@]} > 0 )); then
  echo "D1: '~/.meowth-test/' must only appear in _test.go files. Found in:" >&2
  printf '  %s\n' "${test_misplaced[@]}" >&2
  fail=1
fi

# ---- ~/.meowth/ may only appear in daemon/internal/home/home.go ----
# We allow daemon/internal/home/home.go (the resolver). Everything
# else under daemon/ that mentions ~/.meowth/ is a violation (init
# CLI, bootstrap-token CLI, store, etc must derive paths via the
# home package).
mapfile -t prod_misplaced < <(grep -RIn --include='*.go' \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=pkg \
  "~/.meowth/" daemon 2>/dev/null \
  | grep -v '^daemon/internal/home/home.go:' \
  | grep -v '_test.go:' \
  || true)
if (( ${#prod_misplaced[@]} > 0 )); then
  echo "D1: '~/.meowth/' must only appear in daemon/internal/home/home.go. Found in:" >&2
  printf '  %s\n' "${prod_misplaced[@]}" >&2
  fail=1
fi

if (( fail != 0 )); then
  exit 1
fi
echo "D1: ok (no prod/test path mix)"
