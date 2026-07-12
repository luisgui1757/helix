#!/usr/bin/env bash
#
# helix-worktree.sh — thin worktree-manager basics on canonical `git worktree`.
#
# Worktrees are the default for implementation / multi-agent work; in-place stays
# available for read-only reviews and tiny edits (ROADMAP §9-Q1). This is the
# Phase-1 "basics" stand-in — create / list / enter / prune / merge / remove —
# NOT a full manager.
#
# SAFE PROVISIONING: `create` copies NOTHING by default. Secrets and heavy blobs
# are never copied: no `.env`, no auth files, no sessions, no node_modules. There
# is deliberately no auto-copy allowlist yet; provision by hand and keep provider
# keys machine-local (docs/m0a/provider-and-egress-posture.md).
#
# Usage:
#   tools/worktree/helix-worktree.sh create <name> [branch] [base]
#   tools/worktree/helix-worktree.sh list
#   tools/worktree/helix-worktree.sh enter <name>
#   tools/worktree/helix-worktree.sh merge <name> [--into <branch>]
#   tools/worktree/helix-worktree.sh remove <name>
#   tools/worktree/helix-worktree.sh prune
#
# Exit: 0 ok · 1 error · 2 bad usage.

set -euo pipefail

die() { echo "helix-worktree: $*" >&2; exit 1; }
usage() { sed -n '13,24p' "$0" | sed 's/^# \{0,1\}//'; }

require_repo() {
  git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
}

# Linked worktrees are created as siblings of the primary checkout:
#   <parent>/<repo>-<name>
worktree_path() {
  local name="$1"
  local top parent repo
  top="$(git rev-parse --show-toplevel)"
  parent="$(dirname "$top")"
  repo="$(basename "$top")"
  printf '%s/%s-%s' "$parent" "$repo" "$name"
}

real_path() {
  ( cd "$1" 2>/dev/null && pwd -P )
}

refuse_current_or_dirty_worktree() {
  local path="$1"
  local current
  current="$(git rev-parse --show-toplevel)"
  if [ "$(real_path "$path")" = "$(real_path "$current")" ]; then
    die "refusing to remove the current worktree: $path"
  fi
  if [ -n "$(git -C "$path" status --porcelain)" ]; then
    die "refusing to remove dirty worktree: $path"
  fi
}

cmd_create() {
  local name="${1:-}" branch="${2:-}" base="${3:-HEAD}"
  [ -n "$name" ] || { usage >&2; exit 2; }
  branch="${branch:-$name}"
  local path; path="$(worktree_path "$name")"
  [ -e "$path" ] && die "path already exists: $path"

  git worktree add -b "$branch" "$path" "$base"
  echo "created worktree: $path (branch $branch, base $base)"
  echo "provisioning: nothing copied (no .env / auth / sessions / node_modules)."
  echo "next: cd \"$path\""
}

cmd_list() {
  git worktree list
}

cmd_enter() {
  local name="${1:-}"; [ -n "$name" ] || { usage >&2; exit 2; }
  local path; path="$(worktree_path "$name")"
  [ -d "$path" ] || die "no worktree for '$name' at $path"
  # A script cannot change the parent shell's cwd; emit the path + hint.
  echo "$path"
  echo "run: cd \"$path\"" >&2
}

cmd_merge() {
  local name="${1:-}"; shift || true
  local into=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --into) into="${2:-}"; shift 2 ;;
      *) die "unknown merge arg: $1" ;;
    esac
  done
  [ -n "$name" ] || { usage >&2; exit 2; }
  local path branch
  path="$(worktree_path "$name")"
  [ -d "$path" ] || die "no worktree for '$name' at $path"
  [ -z "$(git -C "$path" status --porcelain)" ] || die "worktree '$name' is dirty; commit/stash before merge"
  branch="$(git -C "$path" rev-parse --abbrev-ref HEAD)"
  [ -n "$into" ] && git switch "$into"
  echo "merging branch '$branch' into '$(git rev-parse --abbrev-ref HEAD)'"
  git merge --no-ff "$branch"
}

cmd_remove() {
  local name="${1:-}"; [ -n "$name" ] || { usage >&2; exit 2; }
  local path; path="$(worktree_path "$name")"
  [ -d "$path" ] || die "no worktree for '$name' at $path"
  refuse_current_or_dirty_worktree "$path"
  git worktree remove "$path"
  git worktree prune
  echo "removed worktree: $path"
}

cmd_prune() {
  git worktree prune -v
  echo "--- remaining worktrees ---"
  git worktree list
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    create) require_repo; cmd_create "$@" ;;
    list)   require_repo; cmd_list "$@" ;;
    enter)  require_repo; cmd_enter "$@" ;;
    merge)  require_repo; cmd_merge "$@" ;;
    remove) require_repo; cmd_remove "$@" ;;
    prune)  require_repo; cmd_prune "$@" ;;
    -h|--help|"") usage ;;
    *) echo "helix-worktree: unknown command '$sub'" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
