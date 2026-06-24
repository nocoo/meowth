#!/usr/bin/env bash
# Build the meowthd Go binary with the Version string injected from
# the root package.json. Called by `pnpm daemon:build` after the
# dashboard dist has been prepared.
#
# Pulling the version with `node -p` inline from package.json caused
# shell-quoting hell when invoked via pnpm; this script keeps the
# pipeline obvious.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")

if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  echo "::error::failed to read version from root package.json" >&2
  exit 1
fi

cd "$ROOT/daemon"
exec go build -ldflags "-X main.Version=$VERSION" -o meowthd ./cmd/meowthd
