#!/usr/bin/env bash
#
# Assert that a web build with VITE_ENABLE_DEBUG=false contains ZERO debug
# markers in dist — i.e. the /debug/* route code is physically excluded from
# the bundle (layer 1 of the debug-exposure defense, access-control.spec.md G8).
#
# The App.tsx debug-route gate is statically eliminable (import.meta.env
# literals only): Vite define-replaces VITE_ENABLE_DEBUG at build time, the
# comparison constant-folds, and Rollup drops the whole block. This script
# locks that in so it cannot silently regress. See src/web/CLAUDE.md.
#
# Usage:
#   scripts/assert-debug-excluded.sh          # build with flag=false, expect PASS
#   scripts/assert-debug-excluded.sh true     # control: build with flag=true, expect FAIL
#
# Exit codes: 0 = no debug markers found; 1 = markers found (assertion failed).

set -euo pipefail
cd "$(dirname "$0")/.."

FLAG="${1:-false}"
DIST="src/web/dist"
PATTERN='DebugPage|StaffDebugPage|/debug'

echo "── assert-debug-excluded: building web bundle with VITE_ENABLE_DEBUG=${FLAG} ──"
# make build = fonts (generates src/index fonts.generated.css) + vite build
VITE_ENABLE_DEBUG="$FLAG" make build

echo "── assert-debug-excluded: scanning ${DIST} compiled output for markers (${PATTERN}) ──"
# Scope: compiled build output only (*.js, *.css, *.html, *.map). Static
# passthrough files from public/ are excluded — robots.txt intentionally
# carries a "Disallow: /debug" crawler rule, which is policy, not code.
MATCHES=$(find "$DIST" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.map' \) \
  -exec grep -lIE "$PATTERN" {} + 2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  echo "FAIL: debug markers found in bundle (matching files):"
  echo "$MATCHES"
  echo "$MATCHES" | while read -r f; do grep -oIE "$PATTERN" "$f" | sort | uniq -c | sed "s|^|  $f: |"; done
  echo "A VITE_ENABLE_DEBUG=false build must not contain debug-route code."
  echo "The App.tsx debug gate is no longer statically eliminable — fix the gate,"
  echo "do not weaken this assertion (src/web/CLAUDE.md, access-control.spec.md G8)."
  exit 1
fi

echo "PASS: zero debug markers in ${DIST} (VITE_ENABLE_DEBUG=${FLAG})"
