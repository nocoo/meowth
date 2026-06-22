#!/usr/bin/env bash
# Copy apps/dashboard/dist into daemon/internal/server/dashboard/dist
# (deterministic, no residue from prior runs) for go:embed pickup.
#
# Fails fast when the source dist is missing or post-copy validation
# fails. Production binaries (`pnpm daemon:build`) call this before
# the Go compile step so they cannot accidentally ship the empty
# .gitkeep compile guard.
set -euo pipefail

SRC="apps/dashboard/dist"
DST="daemon/internal/server/dashboard/dist"

if [ ! -d "$SRC" ]; then
  echo "::error::$SRC missing; run 'pnpm --filter @meowth/dashboard build' first" >&2
  exit 1
fi
if [ ! -f "$SRC/index.html" ]; then
  echo "::error::$SRC/index.html missing; dashboard build did not produce index.html" >&2
  exit 1
fi

mkdir -p "$DST"
# Clean DST, keep .gitkeep
find "$DST" -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} +

# Copy preserving the dist tree.
cp -R "$SRC"/. "$DST"/

# Fail-fast: post-copy validation.
if [ ! -f "$DST/index.html" ]; then
  echo "::error::$DST/index.html missing after copy" >&2
  exit 1
fi
if [ -z "$(find "$DST/assets" -maxdepth 1 -name 'index-*.js' -print -quit 2>/dev/null)" ]; then
  echo "::error::$DST/assets/index-*.js missing; Vite hashed JS not embedded" >&2
  exit 1
fi
echo "prepare-dashboard-embed: OK"
