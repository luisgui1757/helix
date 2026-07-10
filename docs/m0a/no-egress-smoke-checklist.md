# No-egress smoke checklist

The runnable checklist that proves the **always-on egress defaults** hold, and the
scoped plan for the deeper **lockdown network trace** (an open Phase-0 task). See
[`provider-and-egress-posture.md`](./provider-and-egress-posture.md) for the controls
and endpoints this exercises.

Two levels, deliberately separated:

- **Level 1 — always-on defaults smoke (M0a-runnable now):** confirm the telemetry/
  version-check switches are set and that offline invocations of `pi` do not depend
  on the network. No special boundary required.
- **Level 2 — lockdown network trace (open Phase-0 task):** a deny-by-default trace
  inside a named OS/network/container boundary. Requires choosing the boundary first.

---

## Level 1 — always-on defaults smoke (RUN 2026-07-03; UPDATED 2026-07-04)

Evidence: [`reviews/m0a/level1-no-egress-2026-07-03.md`](../../reviews/m0a/level1-no-egress-2026-07-03.md).
**Telemetry + offline-startup checks PASS.** The provider-default sub-check was open in
the original 2026-07-03 evidence and is now **closed for this machine** by the
2026-07-04 addendum: machine-local `defaultProvider` is non-`google`. No model call has
been run. The committed `.pi/settings.json` below applies only to a **trusted** project
(or `--approve`); the env switches are the trust-independent controls.

Environment posture (all four, defense-in-depth — §provider-and-egress-posture):

- [x] `PI_OFFLINE=1` / `--offline` set for the session
- [x] `PI_SKIP_VERSION_CHECK=1` set
- [x] `PI_TELEMETRY=0` set
- [x] `enableInstallTelemetry=false` — shipped in committed `.pi/settings.json`
      (project settings override global; global default is `true`). **Applies only to a
      trusted project / `--approve`** (`docs/settings.md:14-16`); env `PI_TELEMETRY=0`
      is the trust-independent guarantee.
- [x] `defaultProvider` points at an **approved** provider (not `google`) — verified
      2026-07-04 by non-secret-key whitelist (`defaultProvider:"openai-codex"` in
      machine-local `~/.pi/agent/settings.json`; shared repo still commits no provider)
- [x] no Google credentials configured — Google/Gemini/Vertex env vars unset; `auth.json`
      not read, policy

Offline-behavior checks (no provider call needed):

- [x] `tools/m0a/collect-evidence.sh` runs to completion offline and reports the
      version pin and docs checksum as **OK** (it forces the offline env for every
      `pi` call).
- [x] `PI_OFFLINE=1 pi --version` and `PI_OFFLINE=1 pi --help` succeed offline
      (no hard `pi.dev` dependency at startup).
- [x] `PI_OFFLINE=1 pi --approve --list-models` loads the committed `.pi/settings.json`
      with **no parse/settings error** (exit 0).
- [x] Startup does **not** hit `https://pi.dev/api/latest-version` or
      `https://pi.dev/api/report-install` — by documented behavior with `PI_OFFLINE=1`
      (`docs/settings.md:80`); **packet-level** confirmation is Level-2.

Optional local observation (RUN 2026-07-04):

- [x] Real-provider no-spend active-session smoke — native Pi OpenRouter call against
      `cohere/north-mini-code:free`, with tools/session/context/resources disabled.
      Evidence:
      [`reviews/m0a/openrouter-free-smoke-2026-07-04.md`](../../reviews/m0a/openrouter-free-smoke-2026-07-04.md).
      This proves a real approved-provider live call; it is not a privileged packet
      capture and does not claim packet-level endpoint exclusivity.

## Level 2 — lockdown network trace (boundary CHOSEN; smoke PASSED 2026-07-04)

**Boundary: Plain Docker, `docker run --network none`** (deny-by-default) — decision +
rejected alternatives in [`lockdown-boundary.md`](./lockdown-boundary.md) (matches Pi
`docs/containerization.md`). **Harness:** [`tools/lockdown/`](../../tools/lockdown/)
(`tools/lockdown/no-egress-smoke.sh [--active]`). **Evidence:**
[`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](../../reviews/m0a/level2-lockdown-smoke-2026-07-04.md)
— 5/5 PASS, no secrets, no spend.

Inside the boundary (no non-loopback interface), with the approved endpoint provided by a
**local mock** on `127.0.0.1`:

- [x] **Idle / startup** makes no unapproved outbound connection — a representative Pi
      startup (`pi --version`, `pi --approve --no-session --list-models` loading settings +
      `prime-ui` + themes + pinned extensions) completes offline with exit 0 and zero
      network available.
- [x] **Active session** (`pi -p`) reaches **only** the approved endpoint (the local mock;
      two requests: `GET /v1/models` + `POST /v1/chat/completions`); a **non-allowlisted**
      endpoint (`pi.dev`, a provider host) is **blocked** (unreachable, `EAI_AGAIN`).
- [x] Evidence saved under `reviews/` — sanitized (boundary, destinations, exit status;
      no payloads/secrets; `auth.json` never read).
- [x] **Real approved-provider** active-session smoke — OpenRouter `:free` path passed
      via `tools/smoke/openrouter-free-smoke.sh` (no spend, no tools/session/context/
      resources, no transcript committed).
- [ ] **`/share`**, web fetches, package socket, and remote-control relay classes:
      structurally blocked here (no network); a **positive** "attempted upload/fetch denied
      against the real relay/endpoint" trace attaches when those features exist and is a
      credentialed maintainer/CI follow-up.

## CI note (grows from Phase 0, per §10 cross-cutting)

The eventual CI egress test runs a representative session under a deny-by-default
network sandbox with a **mock/local provider** and fails the build on any unapproved
outbound connection. Document any platform mismatch between Linux CI and the
developer's chosen local boundary (e.g. macOS). This is scoped here but built with
the test harness, not in M0a.

## Definition of "passed" for M0a

M0a's Level-1 smoke has the telemetry/offline-startup checks passed and the machine-local
non-`google` provider applied for this machine. The committed `.pi/settings.json` baseline
still applies only to a **trusted** project; env switches are the trust-independent
controls. **Level-2 (2026-07-04):** the boundary is **chosen** (Plain Docker
`--network none`) and the Level-2 smoke **passed 5/5** for the no-network + local-mock
class (deny-by-default egress, offline startup, active session reaching only the approved
mock) — evidence `reviews/m0a/level2-lockdown-smoke-2026-07-04.md`. **Real-provider
smoke (2026-07-04):** OpenRouter `:free` active session passed via
`tools/smoke/openrouter-free-smoke.sh`; stronger packet-level endpoint exclusivity is not
claimed. **Still not claimed done:** a positive `/share`-denied trace against the real
relay.
