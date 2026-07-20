#!/usr/bin/env bash
#
# no-egress-smoke.sh — Helix Level-2 lockdown smoke (canonical boundary: Plain
# Docker with `--network none`, per Pi's docs/containerization.md).
#
# WHAT IT PROVES (deny-by-default, no secrets, no spend, no host firewall changes):
#   1. deny-egress   — inside `--network none`, an outbound connection to a
#                      non-allowlisted endpoint (pi.dev, a provider host) is
#                      BLOCKED (no route). Deny-by-default is real, not configured.
#   2. startup-offline — a representative Pi startup path (`pi --version`, then
#                      `pi -e /workspace --approve --no-session --list-models`)
#                      loads the Helix package with ZERO network available.
#   3. active-mock (opt-in, --active) — a full Pi session (`pi -p`) routed at a
#                      LOCAL mock "approved provider" on 127.0.0.1 returns its
#                      canned reply, proving model traffic reaches only the
#                      approved endpoint while external egress stays impossible.
#
# PUBLIC-SAFETY: records boundary, destinations, and exit status only — never
# prompts, payloads, headers, keys, or auth.json. The container never receives
# real provider credentials; the mock uses a dummy key generated at runtime.
#
# Usage:
#   tools/lockdown/no-egress-smoke.sh            # build + checks 1 and 2
#   tools/lockdown/no-egress-smoke.sh --active   # also run check 3 (mock session)
#   tools/lockdown/no-egress-smoke.sh --no-build # reuse an existing image
#
# Exit status: 0 all required checks passed; 1 a required check failed;
#              2 bad usage; 3 Docker unavailable (harness ready, not run).

set -euo pipefail

PI_VERSION="0.80.7"
IMAGE="helix-lockdown-smoke:${PI_VERSION}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DO_BUILD=1
DO_ACTIVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --active)   DO_ACTIVE=1 ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

pass_count=0
fail_count=0
results=""

record() { # name  result(PASS/FAIL/SKIP)  detail
  results="${results}\n  ${2}  ${1} — ${3}"
  [ "$2" = "PASS" ] && pass_count=$((pass_count + 1))
  [ "$2" = "FAIL" ] && fail_count=$((fail_count + 1))
  return 0
}

# docker run wrapper: deny-by-default network, read-only repo mount, offline env.
drun() {
  docker run --rm --network none \
    -v "${REPO_ROOT}:/workspace:ro" -w /workspace \
    -e PI_OFFLINE=1 -e PI_TELEMETRY=0 -e PI_SKIP_VERSION_CHECK=1 \
    "${IMAGE}" "$@"
}

echo "# Helix Level-2 lockdown smoke"
echo "  boundary:   Plain Docker, docker run --network none (deny-by-default)"
echo "  image:      ${IMAGE}"
echo "  repo mount: ${REPO_ROOT} -> /workspace (read-only)"
echo "  host os:    $(uname -srm)"

# --- Docker availability -----------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo
  echo "SKIPPED: Docker is not available (command missing or daemon down)."
  echo "The harness is ready. Run this on a host/CI with Docker to produce evidence."
  exit 3
fi
echo "  docker:     $(docker --version)"

# --- Build -------------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  echo
  echo "## Building image (build-time network installs pinned Pi ${PI_VERSION})"
  docker build --quiet -t "${IMAGE}" -f "${SCRIPT_DIR}/Dockerfile" "${SCRIPT_DIR}" >/dev/null
  echo "  built ${IMAGE}"
fi

echo
echo "## Checks"

# --- Check 1: deny-by-default egress ----------------------------------------
# An outbound fetch to a non-allowlisted endpoint must fail (no route in --network none).
for host in "https://pi.dev/api/latest-version" "https://api.openai.com/v1/models"; do
  if drun node -e "fetch('${host}',{signal:AbortSignal.timeout(5000)}).then(()=>{console.log('REACHED');process.exit(9)}).catch(e=>{console.log('blocked:'+(e.cause&&e.cause.code||e.name));process.exit(0)})" >/tmp/helix_deny.$$ 2>&1; then
    record "deny-egress -> ${host}" "PASS" "$(cat /tmp/helix_deny.$$)"
  else
    record "deny-egress -> ${host}" "FAIL" "endpoint was REACHABLE (exit $?)"
  fi
  rm -f /tmp/helix_deny.$$
done

# --- Check 2: representative Pi startup path, offline + no network -----------
if drun pi --version >/tmp/helix_ver.$$ 2>&1 && grep -q "${PI_VERSION}" /tmp/helix_ver.$$; then
  record "startup: pi --version" "PASS" "exit 0, reports ${PI_VERSION}"
else
  record "startup: pi --version" "FAIL" "exit $? / version mismatch"
fi
rm -f /tmp/helix_ver.$$

if drun pi -e /workspace --approve --no-session --list-models >/tmp/helix_lm.$$ 2>&1; then
  record "startup: Pi loads Helix package offline" "PASS" "exit 0"
else
  record "startup: pi --approve --list-models" "FAIL" "exit $?"
fi
rm -f /tmp/helix_lm.$$

# --- Check 3 (opt-in): active session to a LOCAL mock approved endpoint ------
if [ "$DO_ACTIVE" -eq 1 ]; then
  if drun bash /workspace/tools/lockdown/container-active-probe.sh >/tmp/helix_active.$$ 2>&1; then
    detail="$(grep -E '^(RESULT|MOCK|PI_RC)' /tmp/helix_active.$$ | tr '\n' ';')"
    record "active-mock: pi session reaches only 127.0.0.1 mock" "PASS" "${detail:-ok}"
  else
    detail="$(tail -3 /tmp/helix_active.$$ | tr '\n' ' ')"
    record "active-mock: pi session reaches only 127.0.0.1 mock" "FAIL" "${detail}"
  fi
  rm -f /tmp/helix_active.$$
else
  record "active-mock (opt-in, --active)" "SKIP" "not requested; run with --active to exercise the mock session"
fi

# --- Report ------------------------------------------------------------------
echo -e "${results}"
echo
echo "## Summary: ${pass_count} passed, ${fail_count} failed"
if [ "$fail_count" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS (required checks)"
exit 0
