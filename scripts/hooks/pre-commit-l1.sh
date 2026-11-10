#!/usr/bin/env bash
# L1 pre-commit: Git index snapshot (checkout-index) + UT/coverage + check-only static.
set -euo pipefail

command -v git >/dev/null 2>&1 || {
  echo "pre-commit: git is required" >&2
  exit 1
}

if [[ "${MEOWTH_PRECOMMIT_SKIP_L1:-}" == 1 ]]; then
  echo "pre-commit: MEOWTH_PRECOMMIT_SKIP_L1=1 (test fixture only)" >&2
  exit 0
fi

repo="$(git rev-parse --show-toplevel)"
cd "$repo"

if [[ "${MEOWTH_PRECOMMIT_L1_FIXTURE:-}" == 1 ]]; then
  snapshot="$(mktemp -d "${TMPDIR:-/tmp}/meowth-index-XXXXXX")"
  trap 'rm -rf "$snapshot"' EXIT
  git checkout-index --all --prefix="$snapshot/"
  if [[ -d "$snapshot/daemon" ]]; then
    (
      cd "$snapshot/daemon"
      if ! test -z "$(gofmt -l .)"; then
        echo "pre-commit: staged Go sources are not formatted (index snapshot)" >&2
        gofmt -l .
        exit 1
      fi
      go test -count=1 -coverprofile=coverage.out ./...
      go tool cover -func=coverage.out | tail -1 | grep -Eq '100\.0%'
    ) || exit 1
  fi
  exit 0
fi

snapshot=
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$snapshot" ]]; then
    rm -rf "$snapshot" || true
    snapshot=
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

echo "pre-commit: G2 staged secret scan"
pnpm scan:gitleaks:staged

snapshot="$(mktemp -d "${TMPDIR:-/tmp}/meowth-index-XXXXXX")"
git checkout-index --all --prefix="$snapshot/"

if [[ ! -d "$repo/node_modules" ]]; then
  echo "pre-commit: node_modules is required; run pnpm install" >&2
  exit 1
fi
if [[ ! -f "$snapshot/package.json" ]] || [[ ! -f "$snapshot/pnpm-lock.yaml" ]]; then
  echo "pre-commit: staged package.json and pnpm-lock.yaml are required" >&2
  exit 1
fi
if ! cmp -s "$snapshot/package.json" "$repo/package.json" || ! cmp -s "$snapshot/pnpm-lock.yaml" "$repo/pnpm-lock.yaml"; then
  echo "pre-commit: staged package.json/pnpm-lock.yaml must match installed worktree copies" >&2
  exit 1
fi

mkdir -p "$snapshot/node_modules" "$snapshot/.cache"
for entry in "$repo/node_modules"/*; do
  [[ -e "$entry" ]] || continue
  ln -s "$entry" "$snapshot/node_modules/$(basename "$entry")"
done
export XDG_CACHE_HOME="$snapshot/.cache"
export XDG_STATE_HOME="$snapshot/.cache"
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
unset GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export PATH="$snapshot/node_modules/.bin:${PATH:-}"

cd "$snapshot"

echo "pre-commit: hook contract tests"
pnpm test:hooks

echo "pre-commit: G1 static (check-only)"
pnpm daemon:g1
pnpm dashboard:g1

echo "pre-commit: L1 unit tests + package coverage gates"
parallel_fail=0
(
  pnpm daemon:test:cover && pnpm daemon:cover:check
) &
pid_daemon=$!
(
  pnpm dashboard:test:cover && pnpm dashboard:cover:check
) &
pid_dashboard=$!
wait "$pid_daemon" || parallel_fail=1
wait "$pid_dashboard" || parallel_fail=1
if [[ "$parallel_fail" -ne 0 ]]; then
  exit 1
fi

echo "pre-commit: L1 TypeScript four-metric gate"
export REPO_ROOT="$snapshot"
bash scripts/check-l1-ts-four-metrics.sh
