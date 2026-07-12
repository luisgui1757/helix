# M0a — Level-2 lockdown smoke evidence

**Date:** 2026-07-04 · **Host:** Darwin 25.5.0 arm64 · **Pi:** `0.80.3`
**Boundary:** Plain Docker with `docker run --network none` (deny-by-default), the
canonical boundary chosen in [`docs/m0a/lockdown-boundary.md`](../../docs/m0a/lockdown-boundary.md)
and documented by Pi in `docs/containerization.md`.
**Harness:** [`tools/lockdown/no-egress-smoke.sh`](../../tools/lockdown/no-egress-smoke.sh)
(+ `Dockerfile`, `mock-openai-endpoint.mjs`, `container-active-probe.sh`).

**Verdict: PASS (5/5).** A representative Pi startup **and** a full Pi session run inside
a container with **no non-loopback network interface**. External endpoints are
unreachable (deny-by-default), and the active session reaches **only** the local
approved mock endpoint. No secrets, no spend, no host firewall changes.

**Public-safe:** records boundary, destinations (host + method/path), and exit status
only. No prompts, payloads, headers, provider keys, or `auth.json` — the container never
receives real credentials; the mock uses a runtime-generated **dummy** key.

## How to reproduce

```sh
tools/lockdown/no-egress-smoke.sh --active
```

Builds `helix-lockdown-smoke:0.80.3` (build-time network installs pinned Pi 0.80.3,
`--ignore-scripts`), then runs each check with `docker run --network none` and the repo
bind-mounted read-only at `/workspace`, offline env set (`PI_OFFLINE=1`,
`PI_TELEMETRY=0`, `PI_SKIP_VERSION_CHECK=1`).

## Results (actual output, 2026-07-04)

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Deny-by-default → `https://pi.dev/api/latest-version` | **PASS** | `blocked:EAI_AGAIN` (no route/DNS in `--network none`) |
| 1 | Deny-by-default → `https://api.openai.com/v1/models` | **PASS** | `blocked:EAI_AGAIN` |
| 2 | Startup `pi --version` | **PASS** | exit 0, reports `0.80.3` |
| 2 | Startup `pi --approve --no-session --list-models` (loads committed `.pi/settings.json` + `helix-ui` skill + Rose Pine themes) | **PASS** | exit 0 |
| 3 | Active session `pi -p` routed at the local mock | **PASS** | `PI_RC=0`; canned reply returned; mock saw only the two requests below |

### Boundary is structurally deny-by-default

```
$ docker run --rm --network none helix-lockdown-smoke:0.80.3 \
    node -e "...print os.networkInterfaces()..."
interfaces: lo
non-loopback: NONE
```

The container has **no** non-loopback interface, so egress to any external host is
impossible by construction — not merely disabled by configuration. The version/update
check and telemetry ping to `pi.dev` therefore cannot occur even if a switch were missed.

### Active-session destinations (mock method/path log)

```
PI_RC=0
MOCK-LOG (method/path only):
  LISTEN 127.0.0.1:8080 model=helix-mock/echo-1
  REQ 1 GET /v1/models
  REQ 2 POST /v1/chat/completions
RESULT=PASS pi session reached only the 127.0.0.1 mock and returned the canned reply
```

The full session (`pi --provider helix-mock --model helix-mock/echo-1 --approve
--no-session --no-tools -p "ping"`) contacted **only** `127.0.0.1:8080` (the approved
local mock) — two requests, no external destination — and Pi returned the mock's canned
assistant message. Loopback survives `--network none`; nothing else is reachable.

## What this proves (Level-2 classes covered)

- **Idle/startup makes no unapproved outbound connection** — startup completes with zero
  network available (check 2).
- **A non-allowlisted endpoint is blocked** — `pi.dev` and a provider host are
  unreachable (check 1); no host firewall rule was added, the boundary provides it.
- **An active session reaches only the approved endpoint** — model traffic went solely
  to the local approved mock (check 3).

## Honest limits (not claimed as done)

- **Real external provider endpoint trace is NOT run here.** Proving that a session
  against a *real* OpenAI/OpenRouter/Copilot endpoint egresses only to that approved host
  needs provider credentials and/or spend and is out of scope for this public-safe,
  no-spend slice. It is a **maintainer-run / CI-with-secrets** follow-up. The mock stands
  in for the approved endpoint to prove the *routing and containment* property without
  secrets.
- **`/share` and other user-invoked uploads** are structurally blocked here (no network),
  but a positive "attempted upload is denied" trace against the real relay is likewise a
  maintainer/credentialed follow-up.
- **macOS vs Linux CI:** this ran via Docker Desktop on macOS (arm64). The same harness
  runs unchanged in Linux CI; `--network none` semantics are identical.
- **No packet capture / pcap:** deny-by-default is proven structurally (no interface) and
  behaviorally (reachability attempts fail), not via a privileged sniffer — deliberately,
  to avoid host-level/privileged tooling.

## Deferred (still open Phase-0)

- Claude-auth **live-billing** probe (§9-Q4) — unchanged, still deferred.

## Addendum (2026-07-04)

A later cleanup slice added a native Pi OpenRouter `:free` live-call smoke:
[`openrouter-free-smoke-2026-07-04.md`](./openrouter-free-smoke-2026-07-04.md).
That closes the real-provider live-call proof without changing this file's narrower
Level-2 no-network/local-mock evidence. Packet-level endpoint exclusivity remains
unclaimed.
