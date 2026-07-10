#!/usr/bin/env bash
#
# selftest.sh — deterministic self-test for objective-gate-loop.sh. No network,
# no models: uses trivial shell gates to prove the stop/continue behavior.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOOP="${SCRIPT_DIR}/objective-gate-loop.sh"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pass=0; fail=0
# expect_exit <desc> <expected-code> <command...>
expect_exit() {
  local desc="$1" want="$2"; shift 2
  "$@" >/dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    echo "  PASS ${desc} (exit ${got})"; pass=$((pass + 1))
  else
    echo "  FAIL ${desc} (want ${want}, got ${got})"; fail=$((fail + 1))
  fi
}

echo "# objective-gate-loop self-test"

# 1. Missing gate must fail loud (exit 3).
expect_exit "missing gate fails loud" 3 "$LOOP"

# 2. Green gate exits 0.
expect_exit "green gate exits 0" 0 "$LOOP" --gate "true"

# 3. Red gate with no fix stops (exit 1).
expect_exit "red gate stops" 1 "$LOOP" --gate "false"

# 4. Seeded failing gate goes red -> green via a fix within max-iters.
MARK="${TMP}/mark"
expect_exit "seeded red->green with fix" 0 \
  "$LOOP" --gate "test -f '${MARK}'" --fix "touch '${MARK}'" --max-iters 3
# The mark now exists — a fresh run is green on iteration 1.
expect_exit "gate green once fixed" 0 "$LOOP" --gate "test -f '${MARK}'"

# 5. Red gate whose fix never satisfies it still stops (exit 1), not a fake pass.
expect_exit "unfixable gate still stops" 1 \
  "$LOOP" --gate "false" --fix "true" --max-iters 3

# 6. Review is SECONDARY: a failing review after a green gate does not fail the run.
expect_exit "failing review does not override green gate" 0 \
  "$LOOP" --gate "true" --review "false"

# 7. Bad --max-iters is a usage error (exit 2).
expect_exit "bad max-iters is usage error" 2 "$LOOP" --gate "true" --max-iters "abc"

echo "# result: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
