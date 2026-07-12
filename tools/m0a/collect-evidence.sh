#!/usr/bin/env bash
#
# collect-evidence.sh — M0a evidence refresh for the `helix` Pi CLI extensions repo.
#
# Captures the environment facts that ROADMAP.md §4 pins, so they can be
# re-verified after `pi update` or on a new machine. This is the repeatable
# source behind docs/m0a/evidence-snapshot.md.
#
# SAFETY / PUBLIC-SAFE CONTRACT:
#   * Default mode makes NO network calls. Pi's startup telemetry/version-check
#     is disabled for every `pi` invocation (PI_OFFLINE + PI_SKIP_VERSION_CHECK
#     + PI_TELEMETRY), so even `pi --version`/`pi --help` stay offline.
#   * It never reads or prints secrets, ~/.pi/agent/auth.json, tokens, or
#     provider key values. It reports no credential material of any kind.
#   * `--network` is opt-in and ONLY queries the public npm registry for
#     already-published metadata of the named lead-candidate packages.
#
# Usage:
#   tools/m0a/collect-evidence.sh            # default: no network
#   tools/m0a/collect-evidence.sh --network  # also fetch npm metadata for named candidates
#   tools/m0a/collect-evidence.sh --help
#
# Exit status:
#   0  evidence collected (checksum DRIFT is reported but is not a failure)
#   1  a required capture failed (e.g. `pi` not installed)
#   2  bad usage

set -euo pipefail

# --- Force Pi offline for every invocation in this script (defense in depth) ---
export PI_OFFLINE=1
export PI_SKIP_VERSION_CHECK=1
export PI_TELEMETRY=0

# --- Pinned expectations (update these in the same change when Pi is upgraded) ---
EXPECTED_PI_VERSION="0.80.3"
EXPECTED_DOCS_CHECKSUM="5aa4edd22108919537fe3f56b80afc3b8fa6d8a678163f3c2a4b8469b53c7a5e"
PI_PACKAGE="@earendil-works/pi-coding-agent"

# Named lead-candidate packages from ROADMAP §7 (metadata checked only with --network).
CANDIDATE_PACKAGES=(remote-pi pi-nvim pi-web-access pi-annotate pi-messenger)

WITH_NETWORK=0

usage() {
  sed -n '3,33p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Argument parsing --------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --network) WITH_NETWORK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

section() { printf '\n## %s\n\n' "$1"; }
kv()      { printf '  %-28s %s\n' "$1" "$2"; }

# --- Header ------------------------------------------------------------------
printf '# helix — M0a evidence snapshot\n\n'
kv "generated (UTC):"  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
kv "mode:"             "$( [ "$WITH_NETWORK" -eq 1 ] && echo 'ONLINE (--network: npm metadata)' || echo 'offline (default, no network)' )"
kv "host os:"          "$(uname -srm)"

# --- Git ---------------------------------------------------------------------
section "Git"
if git rev-parse --git-dir >/dev/null 2>&1; then
  kv "branch:"  "$(git branch --show-current)"
  kv "head:"    "$(git rev-parse HEAD)"
  printf '  status (porcelain):\n'
  if git status --short | grep -q .; then
    git status --short | sed 's/^/    /'
  else
    printf '    (clean)\n'
  fi
else
  kv "git:" "not a git repository"
fi

# --- Toolchain ---------------------------------------------------------------
section "Toolchain"
kv "node:" "$(command -v node >/dev/null 2>&1 && node --version || echo 'not found')"
kv "npm:"  "$(command -v npm  >/dev/null 2>&1 && npm --version  || echo 'not found')"

NPM_ROOT=""
if command -v npm >/dev/null 2>&1; then
  NPM_ROOT="$(npm root -g 2>/dev/null || true)"
fi
kv "npm root -g:" "${NPM_ROOT:-unknown}"

# --- Pi CLI ------------------------------------------------------------------
section "Pi CLI"
PI_FOUND=1
if ! command -v pi >/dev/null 2>&1; then
  PI_FOUND=0
  kv "which pi:" "NOT FOUND"
  echo
  echo "ERROR: \`pi\` is not installed or not on PATH. Cannot collect Pi evidence." >&2
  echo "       Install the Pi CLI ($PI_PACKAGE) before re-running." >&2
  exit 1
fi

PI_PATH="$(command -v pi)"
PI_VERSION="$(pi --version 2>/dev/null || echo 'unknown')"
kv "which pi:"       "$PI_PATH"
kv "pi --version:"   "$PI_VERSION"
kv "expected:"       "$EXPECTED_PI_VERSION"
if [ "$PI_VERSION" = "$EXPECTED_PI_VERSION" ]; then
  kv "version match:" "OK"
else
  kv "version match:" "DRIFT — update the §4 pin and EXPECTED_PI_VERSION"
fi

# --- Installed package -------------------------------------------------------
section "Installed Pi package"
PKG_DIR=""
INSTALLED_PKG_VERSION="unknown"
if [ -n "$NPM_ROOT" ] && [ -d "$NPM_ROOT/$PI_PACKAGE" ]; then
  PKG_DIR="$NPM_ROOT/$PI_PACKAGE"
  if [ -f "$PKG_DIR/package.json" ] && command -v node >/dev/null 2>&1; then
    INSTALLED_PKG_VERSION="$(node -e "process.stdout.write(require('$PKG_DIR/package.json').version)" 2>/dev/null || echo 'unknown')"
  fi
fi
kv "package:"       "$PI_PACKAGE"
kv "package dir:"   "${PKG_DIR:-not found under npm root}"
kv "package version:" "$INSTALLED_PKG_VERSION"

# --- Docs/examples checksum (reproduces ROADMAP §4) --------------------------
section "Docs/examples checksum"
DOCS_CHECKSUM="unavailable"
if [ -n "$PKG_DIR" ]; then
  # Same command recorded in ROADMAP §4, run inside the package directory.
  DOCS_CHECKSUM="$(
    cd "$PKG_DIR" &&
    find docs examples README.md CHANGELOG.md -type f | sort | xargs shasum -a 256 | shasum -a 256 | awk '{print $1}'
  )" || DOCS_CHECKSUM="error"
fi
kv "checksum:"  "$DOCS_CHECKSUM"
kv "expected:"  "$EXPECTED_DOCS_CHECKSUM"
if [ "$DOCS_CHECKSUM" = "$EXPECTED_DOCS_CHECKSUM" ]; then
  kv "checksum match:" "OK"
elif [ "$DOCS_CHECKSUM" = "unavailable" ] || [ "$DOCS_CHECKSUM" = "error" ]; then
  kv "checksum match:" "SKIPPED (package dir unavailable)"
else
  kv "checksum match:" "DRIFT — docs/examples changed; re-verify claims and re-pin §4"
fi
# The next line prints the checksum command as literal documentation text; the
# `$(npm root -g)` must NOT expand here, so single quotes are intentional.
# shellcheck disable=SC2016
printf '  command:\n    cd "$(npm root -g)/%s" && \\\n' "$PI_PACKAGE"
printf '      find docs examples README.md CHANGELOG.md -type f | sort | xargs shasum -a 256 | shasum -a 256\n'

# --- Command surface (pi subcommands + config) -------------------------------
section "Command surface (pi subcommands)"
# The `Commands:` block of `pi --help` — the built-in `pi <subcommand>` surface
# relevant to the M0a command-surface inventory. `pi config` gates package
# resource enable/disable (command-surface trimming).
pi --help 2>/dev/null | awk '/^Commands:/{p=1} p{print "  " $0} /^Options:/{p=0}' | sed '/^  Options:/d'
kv "note:" "the interactive '/' menu is not emitted by --help; inventory it in a TUI session (see docs/m0a/command-surface-inventory.md)"

# --- Optional: npm metadata for named candidates (opt-in) --------------------
section "Named lead-candidate package metadata"
if [ "$WITH_NETWORK" -eq 0 ]; then
  kv "status:" "SKIPPED (default offline mode; re-run with --network to fetch)"
  kv "candidates:" "${CANDIDATE_PACKAGES[*]}"
else
  if ! command -v curl >/dev/null 2>&1; then
    kv "status:" "curl not found — cannot fetch metadata"
  else
    printf '  Source: public npm registry (https://registry.npmjs.org). Read-only metadata only.\n'
    printf '  Compat target: installed Pi = %s\n\n' "$PI_VERSION"
    for pkg in "${CANDIDATE_PACKAGES[@]}"; do
      meta="$(curl -fsS --max-time 20 "https://registry.npmjs.org/${pkg}/latest" 2>/dev/null || echo '')"
      if [ -z "$meta" ]; then
        kv "$pkg:" "no registry response (unpublished, renamed, or network blocked)"
        continue
      fi
      ver="$(printf '%s' "$meta" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).version||'?')}catch{console.log('?')}})" 2>/dev/null || echo '?')"
      # Declared @earendil-works/pi-coding-agent range across deps/peerDeps/devDeps.
      range="$(printf '%s' "$meta" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const k='$PI_PACKAGE';const r=(j.peerDependencies&&j.peerDependencies[k])||(j.dependencies&&j.dependencies[k])||(j.devDependencies&&j.devDependencies[k])||'(none declared)';console.log(r)}catch{console.log('(parse error)')}})" 2>/dev/null || echo '(parse error)')"
      kv "$pkg:" "latest=$ver   $PI_PACKAGE range: $range"
    done
    printf '\n  NOTE: version + declared Pi range only. Stars/downloads/recency/license and the\n'
    printf '  no-exfiltration source audit are the full catalog gate (ROADMAP §5) and belong\n'
    printf '  in reviews/package-audits/<date>-<slug>/ — not in this baseline script.\n'
  fi
fi

# --- Summary -----------------------------------------------------------------
section "Summary"
kv "pi installed:"   "$( [ "$PI_FOUND" -eq 1 ] && echo yes || echo no )"
kv "version pin:"    "$( [ "$PI_VERSION" = "$EXPECTED_PI_VERSION" ] && echo OK || echo DRIFT )"
kv "docs checksum:"  "$( [ "$DOCS_CHECKSUM" = "$EXPECTED_DOCS_CHECKSUM" ] && echo OK || echo 'DRIFT/SKIPPED' )"
printf '\nDone. On any DRIFT: re-verify affected ROADMAP claims, then update §4 pins and the\nEXPECTED_* values in this script in the same change.\n'
