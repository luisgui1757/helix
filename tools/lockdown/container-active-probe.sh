#!/usr/bin/env bash
#
# container-active-probe.sh — runs INSIDE the deny-by-default container
# (`--network none`) launched by no-egress-smoke.sh --active. Not meant to be
# run on the host.
#
# Proves a full Pi session routes model traffic ONLY to a local mock "approved
# provider" on 127.0.0.1 (loopback survives --network none) and returns its
# canned reply, while any external endpoint stays unreachable.
#
# PUBLIC-SAFETY: uses an isolated agent dir under /tmp with a DUMMY key (never a
# real credential); logs only the mock's method/path lines and the pass/fail
# result — no prompts, no payloads, no keys.

set -euo pipefail

AGENT_DIR="/tmp/helix-agent"
PORT="8080"
MODEL="helix-mock/echo-1"
mkdir -p "${AGENT_DIR}"

# Isolated models.json pointing Pi at the local mock. Dummy key only.
cat > "${AGENT_DIR}/models.json" <<JSON
{
  "providers": {
    "helix-mock": {
      "baseUrl": "http://127.0.0.1:${PORT}/v1",
      "api": "openai-completions",
      "apiKey": "helix-mock-dummy-key",
      "authHeader": true,
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [ { "id": "echo-1", "contextWindow": 8192, "maxTokens": 256 } ]
    }
  }
}
JSON

# Start the local mock approved endpoint.
node /workspace/tools/lockdown/mock-openai-endpoint.mjs --port "${PORT}" --model "${MODEL}" \
  >/dev/null 2>"${AGENT_DIR}/mock.log" &
MOCK_PID=$!
trap 'kill "${MOCK_PID}" 2>/dev/null || true' EXIT

# Wait for the mock to accept connections on loopback.
ready=0
for _ in $(seq 1 40); do
  if node -e "fetch('http://127.0.0.1:${PORT}/v1/models',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=1; break
  fi
  sleep 0.25
done
if [ "${ready}" -ne 1 ]; then
  echo "RESULT=FAIL mock did not become ready on 127.0.0.1:${PORT}"
  exit 1
fi

# Run a real Pi session in print mode against the mock provider.
export PI_CODING_AGENT_DIR="${AGENT_DIR}"
set +e
OUT="$(pi --provider helix-mock --model "${MODEL}" --approve --no-session --no-tools -p "ping" 2>"${AGENT_DIR}/pi.err")"
PI_RC=$?
set -e

echo "PI_RC=${PI_RC}"
echo "MOCK-LOG (method/path only):"
sed 's/^/  /' "${AGENT_DIR}/mock.log" || true

got_canned=0
echo "${OUT}" | grep -q "helix-lockdown-mock-ok" && got_canned=1
mock_chat=0
grep -q "POST /v1/chat/completions" "${AGENT_DIR}/mock.log" && mock_chat=1

if [ "${PI_RC}" -eq 0 ] && [ "${got_canned}" -eq 1 ] && [ "${mock_chat}" -eq 1 ]; then
  echo "RESULT=PASS pi session reached only the 127.0.0.1 mock and returned the canned reply"
  exit 0
fi
echo "RESULT=FAIL rc=${PI_RC} canned=${got_canned} mock_chat=${mock_chat}"
echo "PI-STDERR-TAIL:"; tail -5 "${AGENT_DIR}/pi.err" 2>/dev/null | sed 's/^/  /' || true
exit 1
