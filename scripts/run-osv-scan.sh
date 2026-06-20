#!/usr/bin/env bash
# Phase 2.10 — osv-scanner wrapper.
#
# Why a wrapper instead of a bare `osv-scanner ...` in package.json:
# osv-scanner is a Go binary that is not feasible to invoke via
# `go run` from a package script (very heavy build-graph download
# on each invocation). We therefore require it to be installed locally
# (e.g. `brew install osv-scanner` on macOS; the CI install step is
# wired in Phase 2.12). This wrapper prints a clear remediation when
# the binary is missing.

set -euo pipefail

EXPECTED="${OSV_SCANNER_VERSION_HINT:-2.3.8}"
LOCKFILE="${OSV_LOCKFILE:-pnpm-lock.yaml}"

if ! command -v osv-scanner >/dev/null 2>&1; then
  cat >&2 <<EOF
osv-scanner: command not found.

Install it before running the G2 gate:

  macOS:  brew install osv-scanner
  Linux:  see https://google.github.io/osv-scanner/installation/

Hint: the gate was authored against osv-scanner $EXPECTED.
The CI workflow (Phase 2.12) installs osv-scanner itself; only
developer machines need this manual step.
EOF
  exit 1
fi

ACTUAL="$(osv-scanner --version 2>&1 | head -1 | awk '{print $NF}')"
echo "osv-scanner: actual=$ACTUAL hint=$EXPECTED lockfile=$LOCKFILE"

exec osv-scanner --lockfile "$LOCKFILE"
