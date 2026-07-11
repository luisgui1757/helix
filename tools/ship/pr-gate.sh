#!/usr/bin/env bash
#
# pr-gate.sh — conservative, fail-closed local "ship" gate chain.
#
# One coherent command (NOT a slash command, to protect the `/` budget). Runs the
# canonical release-hygiene sequence mapped to this repo's real checks:
#   intent -> status/rebase -> review -> tests -> resources -> lint ->
#   public-safety -> push/PR checklist.
#
# HARD gates fail the run (exit 1). ADVISORY steps print reminders only. It is
# fail-closed: the public-safety scan always runs (grep), and a hard gate that
# cannot be evaluated is reported and fails. It does NOT push or open a PR, and it
# is not an unbypassable interceptor — it is a checklist you run before pushing.
#
# Usage:
#   tools/ship/pr-gate.sh [--base <ref>] [--dry-run]
#     --base    base ref to diff against (default: origin/main)
#     --dry-run print the plan and run read-only checks; never fail on dirty tree
#
# Exit: 0 all hard gates passed · 1 a hard gate failed · 2 bad usage.

set -uo pipefail

BASE="origin/main"
DRY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base)    BASE="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "pr-gate: unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

hard_fail=0
step() { printf '\n== %s ==\n' "$1"; }
advisory() { printf '  (advisory) %s\n' "$1"; }
pass() { printf '  PASS %s\n' "$1"; }
failg() { printf '  FAIL %s\n' "$1"; hard_fail=$((hard_fail + 1)); }

# Resolve the diff range against the base if it exists.
RANGE=""
if git rev-parse --verify --quiet "$BASE" >/dev/null; then
  MB="$(git merge-base "$BASE" HEAD 2>/dev/null || true)"
  [ -n "$MB" ] && RANGE="${MB}..HEAD"
fi
changed_files() { if [ -n "$RANGE" ]; then git diff --name-only "$RANGE"; else git diff --name-only HEAD; fi; }
diff_text() { if [ -n "$RANGE" ]; then git diff "$RANGE"; else git diff HEAD; fi; }

# --- 1. Intent --------------------------------------------------------------
step "1. Intent"
advisory "State in one sentence what changed and why; trace it to a source of truth."
BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  failg "detached HEAD — ship from a named feature branch"
elif [ "$BRANCH" = "main" ]; then
  failg "on 'main' — ship from a feature branch"
else
  pass "on feature branch '$BRANCH'"
fi

# --- 2. Status / rebase -----------------------------------------------------
step "2. Status / rebase"
if [ -n "$RANGE" ]; then pass "base '$BASE' found; diffing $RANGE"; else advisory "base '$BASE' not found; diffing working tree vs HEAD"; fi
if [ "$DRY" -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
  failg "working tree is dirty — commit or stash before shipping"
else
  if [ "$DRY" -eq 1 ]; then advisory "dry-run: skipping clean-tree gate"; else pass "working tree clean"; fi
fi

# --- 3. Review --------------------------------------------------------------
step "3. Review"
advisory "Independent second-provider review for meaningful work (docs/m0a/vertical-smoke/second-provider-review-handoff.md)."

# --- 4. Tests (hard) --------------------------------------------------------
step "4. Tests"
if node -e "process.exit(require('./package.json').scripts?.test?0:1)" 2>/dev/null; then
  if npm test --silent >/tmp/prgate_test.$$ 2>&1; then pass "npm test"; else failg "npm test (see output)"; tail -8 /tmp/prgate_test.$$; fi
  rm -f /tmp/prgate_test.$$
else
  advisory "no npm test script"
fi

# --- 5. Resources (hard) ----------------------------------------------------
step "5. Resources"
if node -e "process.exit(require('./package.json').scripts?.['check:resources']?0:1)" 2>/dev/null; then
  if npm run --silent check:resources >/dev/null 2>&1; then pass "npm run check:resources"; else failg "npm run check:resources"; fi
else
  advisory "no check:resources script"
fi

# --- 6. Lint (hard where runnable) ------------------------------------------
step "6. Lint"
if git diff --check "${RANGE:-HEAD}" >/dev/null 2>&1; then pass "git diff --check"; else failg "git diff --check (whitespace/conflict markers)"; fi
if command -v shellcheck >/dev/null 2>&1; then
  # Deleted scripts cannot be linted — keep only paths that still exist.
  SH_LIST="$(changed_files | grep -E '\.sh$' | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done || true)"
  if [ -n "$SH_LIST" ]; then
    SH_COUNT="$(printf '%s\n' "$SH_LIST" | wc -l | tr -d ' ')"
    if printf '%s\n' "$SH_LIST" | xargs shellcheck >/dev/null 2>&1; then pass "shellcheck (${SH_COUNT} script(s))"; else failg "shellcheck findings"; fi
  else advisory "no changed shell scripts"; fi
else advisory "shellcheck not installed — cannot lint shell scripts"; fi

# --- 7. Public-safety (hard, always runs) -----------------------------------
step "7. Public-safety scan"
if diff_text | node tools/ci/public-safety-diff-scan.mjs --stdin --mode diff >/tmp/prgate_public_safety.$$ 2>&1; then
  pass "no secrets / session URLs / provenance / home paths in diff"
else
  failg "public-safety diff scan"
  tail -8 /tmp/prgate_public_safety.$$
fi
rm -f /tmp/prgate_public_safety.$$

# --- 8. Push / PR checklist -------------------------------------------------
step "8. Push / PR (checklist)"
advisory "Commit message clean, no AI/provenance trailers."
advisory "Push branch; open PR vs main (non-draft); include summary/closed/open/checks/public-safety/files."
advisory "Do not merge without maintainer approval."

# --- Summary ----------------------------------------------------------------
printf '\n== Summary ==\n'
if [ "$hard_fail" -eq 0 ]; then
  echo "RESULT: PASS (all hard gates green). Advisory items are your responsibility."
  exit 0
fi
echo "RESULT: FAIL — ${hard_fail} hard gate(s) failed. Fix before pushing (fail-closed)."
exit 1
