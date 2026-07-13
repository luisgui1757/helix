#!/usr/bin/env bash
#
# objective-gate-loop.sh — implement -> OBJECTIVE-GATE -> review -> fix, thin.
#
# The OBJECTIVE GATE is the PRIMARY termination signal (tests / lint / typecheck /
# a named check). Rules:
#   * A MISSING gate FAILS LOUD and STOPS (exit 3). Never proceed "because the
#     model thinks it is done" — no gate means no source of truth.
#   * The loop only exits 0 when the gate actually passes.
#   * A red gate stops and surfaces (exit 1); it is not massaged into a pass.
#   * LLM review is SECONDARY: an optional --review runs only after a green gate
#     and is advisory — it never flips the exit code. Objective checks decide.
#
# Usage:
#   objective-gate-loop.sh --gate '<command>' [--fix '<command>'] \
#                          [--review '<command>'] [--max-iters N]
#
# Exit: 0 gate green · 1 gate red (stopped) · 2 bad usage · 3 no gate (fail loud).

set -euo pipefail

GATE=""
FIX=""
REVIEW=""
MAX_ITERS=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --gate)      GATE="${2:-}"; shift 2 ;;
    --fix)       FIX="${2:-}"; shift 2 ;;
    --review)    REVIEW="${2:-}"; shift 2 ;;
    --max-iters) MAX_ITERS="${2:-1}"; shift 2 ;;
    -h|--help)   sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "objective-gate-loop: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Fail loud on a missing gate — this is the whole point.
if [ -z "$GATE" ]; then
  echo "objective-gate-loop: NO OBJECTIVE GATE given." >&2
  echo "A missing gate is a STOP, not a pass. Refusing to proceed without a checkable" >&2
  echo "source of truth (tests / lint / typecheck / a named check)." >&2
  exit 3
fi

case "$MAX_ITERS" in
  ''|*[!0-9]*) echo "objective-gate-loop: --max-iters must be a positive integer" >&2; exit 2 ;;
esac
[ "$MAX_ITERS" -ge 1 ] || { echo "objective-gate-loop: --max-iters must be >= 1" >&2; exit 2; }

iter=0
while :; do
  iter=$((iter + 1))
  echo "[iter ${iter}/${MAX_ITERS}] gate: ${GATE}"
  if bash -c "$GATE"; then
    echo "GATE GREEN after ${iter} iteration(s)."
    if [ -n "$REVIEW" ]; then
      echo "[review] (secondary, advisory) running: ${REVIEW}"
      if bash -c "$REVIEW"; then
        echo "[review] advisory PASS — objective gate already decided; exit unaffected."
      else
        echo "[review] advisory findings — surface them, but the objective gate is the decision." >&2
      fi
    fi
    exit 0
  fi

  echo "GATE RED (iter ${iter})." >&2
  if [ -n "$FIX" ] && [ "$iter" -lt "$MAX_ITERS" ]; then
    echo "[iter ${iter}] fix: ${FIX}"
    bash -c "$FIX" || echo "[iter ${iter}] fix command exited non-zero; re-checking gate anyway." >&2
    continue
  fi

  echo "objective-gate-loop: gate did not pass within ${MAX_ITERS} iteration(s)." >&2
  echo "Stopping and surfacing — NOT claiming done." >&2
  exit 1
done
