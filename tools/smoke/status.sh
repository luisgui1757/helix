#!/usr/bin/env bash
#
# status.sh — Helix thin-vertical-smoke status visibility (offline, no secrets).
#
# A one-shot, read-only view of the safety/provider/worktree context a future
# status bar will surface. It makes NO network call and reads NO secrets: it
# never reads or prints `~/.pi/agent/auth.json`, tokens, or provider key values.
# For the machine-local provider it reports presence + whether it is `google`
# only (provider name, never a key).
#
# Usage: tools/smoke/status.sh

set -euo pipefail

export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0

kv() { printf '  %-26s %s\n' "$1" "$2"; }

echo "# Helix status (offline, no secrets)"

# --- Pi ---------------------------------------------------------------------
if command -v pi >/dev/null 2>&1; then
  kv "pi version:" "$(pi --version 2>/dev/null || echo unknown)"
else
  kv "pi version:" "pi not on PATH"
fi

# --- Git / worktree ---------------------------------------------------------
if git rev-parse --git-dir >/dev/null 2>&1; then
  kv "branch:" "$(git branch --show-current 2>/dev/null || echo '(detached)')"
  # A linked worktree has a .git *file* (gitdir pointer); the main tree has a dir.
  if [ -f "$(git rev-parse --show-toplevel)/.git" ]; then
    kv "worktree:" "linked worktree"
  else
    kv "worktree:" "primary checkout"
  fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    kv "tree state:" "dirty ($(git status --porcelain | wc -l | tr -d ' ') changed)"
  else
    kv "tree state:" "clean"
  fi
else
  kv "git:" "not a git repository"
fi

# --- Machine-local provider default (presence + non-google only; NO secrets) -
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
HELIX_DIR="${HELIX_STATE_DIR:-${AGENT_DIR}/helix}"
if [ -n "${HELIX_STATE_DIR:-}" ]; then
  kv "helix state:" "HELIX_STATE_DIR override"
else
  kv "helix state:" "Pi agent directory / helix"
fi
if [ -f "${HELIX_DIR}/settings.json" ] && command -v node >/dev/null 2>&1; then
  node -e '
    const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const toggles=Object.values(s.toggles||{});
    console.log("  "+"helix features:".padEnd(26)+" "+toggles.filter(Boolean).length+"/"+toggles.length+" enabled");
  ' "${HELIX_DIR}/settings.json"
else
  kv "helix features:" "defaults (all enabled)"
fi

if [ -f "${AGENT_DIR}/settings.json" ] && command -v node >/dev/null 2>&1; then
  node -e '
    const f=process.argv[1];
    let s={};try{s=JSON.parse(require("fs").readFileSync(f,"utf8"))}catch{}
    const dp=s.defaultProvider;
    const p=(k,v)=>console.log("  "+(k+":").padEnd(26)+" "+v);
    if(dp===undefined){p("default provider","unset (Pi default: google)")}
    else{p("default provider", dp==="google"?"google (NOT approved)":"set, non-google")}
  ' "${AGENT_DIR}/settings.json"
else
  kv "default provider:" "no machine-local settings.json"
fi

echo
echo "Note: offline, read-only. auth.json is never read. Provider keys/models are not printed."
