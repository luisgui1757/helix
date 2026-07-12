#!/usr/bin/env bash
#
# selftest.sh — deterministic self-test for helix-worktree.sh. Creates a throwaway
# git repo in a temp dir, exercises create/list/enter/merge/remove/prune, and
# asserts behavior. No network, no touching the real repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WT="${SCRIPT_DIR}/helix-worktree.sh"
GIT="git -c user.email=selftest@helix.local -c user.name=selftest -c commit.gpgsign=false -c init.defaultBranch=main"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pass=0; fail=0
# check <description> <command...> : run command, PASS if it exits 0.
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS ${desc}"; pass=$((pass + 1))
  else
    echo "  FAIL ${desc}"; fail=$((fail + 1))
  fi
}
realp() { ( cd "$1" 2>/dev/null && pwd -P ); }

# --- set up a primary checkout ----------------------------------------------
REPO="${TMP}/repo"
mkdir -p "$REPO"
$GIT -C "$REPO" init -q
echo "hello" > "${REPO}/file.txt"
# An untracked secret in the primary must NOT propagate to a worktree.
printf 'SECRET=should-not-copy\n' > "${REPO}/.env"
$GIT -C "$REPO" add file.txt
$GIT -C "$REPO" commit -qm "init"

echo "# helix-worktree self-test"

# --- create -----------------------------------------------------------------
( cd "$REPO" && "$WT" create feat >/dev/null )
WT_PATH="${TMP}/repo-feat"
check "create makes the worktree dir" test -d "$WT_PATH"
check "create checks out branch feat" \
  test "$( $GIT -C "$WT_PATH" rev-parse --abbrev-ref HEAD )" = "feat"

# --- no secret copied -------------------------------------------------------
check "worktree contains no .env (no secret copy)" test ! -e "${WT_PATH}/.env"

# --- list -------------------------------------------------------------------
check "list shows the worktree" bash -c "cd '$REPO' && '$WT' list | grep -q repo-feat"

# --- enter (compare resolved paths; macOS temp dirs are symlinked) ----------
ENTER_OUT="$( cd "$REPO" && "$WT" enter feat 2>/dev/null )"
check "enter prints the worktree path" test "$(realp "$ENTER_OUT")" = "$(realp "$WT_PATH")"

# --- merge ------------------------------------------------------------------
echo "change" > "${WT_PATH}/file2.txt"
$GIT -C "$WT_PATH" add file2.txt
$GIT -C "$WT_PATH" commit -qm "feat change"
( cd "$REPO" \
    && GIT_CONFIG_COUNT=3 \
       GIT_CONFIG_KEY_0=user.email GIT_CONFIG_VALUE_0=selftest@helix.local \
       GIT_CONFIG_KEY_1=user.name  GIT_CONFIG_VALUE_1=selftest \
       GIT_CONFIG_KEY_2=commit.gpgsign GIT_CONFIG_VALUE_2=false \
       "$WT" merge feat >/dev/null )
check "merge brings the branch change into primary" test -f "${REPO}/file2.txt"

# --- remove protection -------------------------------------------------------
check "remove refuses the current worktree" \
  bash -c "cd '$WT_PATH'; ! '$WT' remove feat >/dev/null 2>&1"

( cd "$REPO" && "$WT" create dirty >/dev/null )
DIRTY_PATH="${TMP}/repo-dirty"
echo "dirty" >> "${DIRTY_PATH}/file.txt"
check "remove refuses a dirty worktree" \
  bash -c "cd '$REPO'; ! '$WT' remove dirty >/dev/null 2>&1"
$GIT -C "$DIRTY_PATH" checkout -- file.txt
( cd "$REPO" && "$WT" remove dirty >/dev/null )
check "remove deletes cleaned dirty-test worktree" test ! -d "$DIRTY_PATH"

# --- remove -----------------------------------------------------------------
( cd "$REPO" && "$WT" remove feat >/dev/null )
check "remove deletes the worktree dir" test ! -d "$WT_PATH"

# --- prune ------------------------------------------------------------------
check "prune runs clean" bash -c "cd '$REPO' && '$WT' prune >/dev/null"

# --- bad usage --------------------------------------------------------------
check "unknown command exits 2" bash -c "cd '$REPO'; '$WT' bogus >/dev/null 2>&1; [ \$? -eq 2 ]"

echo "# result: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
